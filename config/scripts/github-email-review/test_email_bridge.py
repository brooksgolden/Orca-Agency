import importlib.util
import json
import queue
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from event_protocol import Chunks, message_id

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('email-bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class RoutingTests(unittest.TestCase):
    def mail(self, body, subject='Re: [stablyai/orca] Sorting (Issue #21765)'):
        return {'subject': subject, 'body': {'content': body}}

    def test_cross_link_cannot_redirect_reply(self):
        mail = self.mail('https://github.com/stablyai/orca/issues/4#issuecomment-9 '
                         'https://github.com/stablyai/orca/issues/21765#issuecomment-8')
        self.assertEqual(bridge.target_from_email(mail)['commentId'], 8)

    def test_ambiguous_comment_and_unrelated_repo_rejected(self):
        self.assertIsNone(bridge.target_from_email(self.mail('https://github.com/evil/orca/issues/21765#issuecomment-8')))
        self.assertIsNone(bridge.target_from_email(self.mail('https://github.com/stablyai/orca/issues/21765#issuecomment-8 '
                                                           'https://github.com/stablyai/orca/issues/21765#issuecomment-9')))

    def test_workflow_alert_routed_without_comment(self):
        item = bridge.target_from_email(self.mail('https://github.com/brooksgolden/Orca-Agency/actions/runs/123',
                                                  '[brooksgolden/Orca-Agency] Run failed: Tests'))
        self.assertEqual(item['kind'], 'workflow')
        self.assertEqual(item['number'], 123)

    def test_new_and_legacy_webhook_require_exact_account(self):
        config = {'triggerId': 'ti_1', 'connectedAccountId': 'ca_1'}
        new = {'type': 'composio.trigger.message', 'metadata': {'trigger_id': 'ti_1',
               'connected_account_id': 'ca_1', 'trigger_slug': 'OUTLOOK_MESSAGE_TRIGGER'},
               'data': {'outlook_message': {'id': 'mail_1'}}}
        self.assertEqual(message_id(new, config), 'mail_1')
        new['metadata']['connected_account_id'] = 'ca_other'
        self.assertIsNone(message_id(new, config))
        legacy = {'type': 'OUTLOOK_MESSAGE_TRIGGER', 'data': {'trigger_nano_id': 'ti_1',
                  'connection_nano_id': 'ca_1', 'message': {'id': 'mail_2'}}}
        self.assertEqual(message_id(legacy, config), 'mail_2')

    def test_chunks_wait_for_all_parts_even_when_final_arrives_first(self):
        decoder = Chunks()
        self.assertIsNone(decoder.add({'id': 'a', 'index': 1, 'chunk': '1}', 'final': True}))
        self.assertEqual(decoder.add({'id': 'a', 'index': 0, 'chunk': '{"x":', 'final': False}), {'x': 1})
        self.assertIsNone(decoder.add({'id': 'b', 'index': 1001, 'chunk': 'junk'}))


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(bridge, 'ROOT', self.root)
        self.root_patch.start()
        self.target = {'repo': 'stablyai/orca', 'number': 21765, 'kind': 'issuecomment-', 'commentId': 8}
        bridge.write(self.root / 'state.json', {'items': {'key': {'key': 'key', 'status': 'pending', 'target': self.target}},
                                               'activeRun': {'state': 'running'}})

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()

    def test_finish_does_not_release_batch_between_items(self):
        bridge.finish('key', 'Already answered')
        self.assertEqual(bridge.state()['items']['key']['status'], 'handled')
        self.assertIsNotNone(bridge.state()['activeRun'])
        with patch.object(bridge, 'wake'):
            bridge.complete_run()
        self.assertIsNone(bridge.state()['activeRun'])

    def test_comment_in_other_thread_never_posted(self):
        reply = self.root / 'reply.md'; reply.write_text('Thanks, please link the PR.')
        responses = [{'user': {'login': 'brooksgolden'}}, [],
                     {'user': {'login': 'other', 'type': 'User'},
                      'html_url': 'https://github.com/stablyai/orca/issues/4#issuecomment-8'}]
        with patch.object(bridge, 'gh', side_effect=responses) as api:
            with self.assertRaisesRegex(ValueError, 'verified thread'):
                bridge.finish('key', 'Useful comment', str(reply))
        self.assertFalse(any(call.kwargs.get('method') == 'POST' for call in api.call_args_list))

    def test_uncertain_post_is_not_repeated(self):
        saved = bridge.state(); saved['items']['key']['postAttemptAt'] = 'earlier'; bridge.write(self.root / 'state.json', saved)
        reply = self.root / 'reply.md'; reply.write_text('Thanks, please link the PR.')
        with patch.object(bridge, 'gh', side_effect=[{'user': {'login': 'brooksgolden'}}, []]) as api:
            with self.assertRaisesRegex(RuntimeError, 'uncertain'):
                bridge.finish('key', 'Useful comment', str(reply))
        self.assertEqual(api.call_count, 2)

    def test_event_failure_remains_durable_for_retry(self):
        with patch.object(bridge, 'enqueue_email', side_effect=RuntimeError('offline')), patch.object(bridge.time, 'sleep'):
            with self.assertRaises(RuntimeError):
                bridge.process_event('message-1')
        self.assertEqual(next(iter(bridge.state()['events'].values()))['status'], 'retry_needed')

    def test_finished_reviewer_does_not_orphan_new_arrivals(self):
        saved = bridge.state()
        saved['activeRun'] = {'startedAt': bridge.now(), 'token': 'batch1', 'receipt': {'run': {'id': 'run1'}}}
        saved['items']['key']['queuedAt'] = '2026-10-04T14:59:00Z'
        saved['items']['key']['runToken'] = 'batch1'
        saved['items']['new'] = {'status': 'pending', 'queuedAt': '2026-10-04T15:01:00Z'}
        bridge.write(self.root / 'state.json', saved)
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        result = {'ok': True, 'result': {'runs': [{'id': 'run1', 'status': 'completed'}]}}
        with patch.object(bridge, 'command', return_value=json.dumps(result)), patch.object(bridge, 'wake'):
            self.assertFalse(bridge.inspect_active_run())
        self.assertEqual(bridge.state()['items']['key']['status'], 'needs_review')
        self.assertEqual(bridge.state()['items']['new']['status'], 'pending')

    def test_expired_callback_cannot_release_later_batch(self):
        saved = bridge.state(); saved['activeRun']['token'] = 'new'; bridge.write(self.root / 'state.json', saved)
        with patch.object(bridge, 'wake') as signal:
            self.assertEqual(bridge.complete_run('old')['result'], 'expired_batch')
        self.assertFalse(signal.called)
        self.assertEqual(bridge.state()['activeRun']['token'], 'new')

    def test_heartbeat_cannot_extend_another_batch(self):
        saved = bridge.state(); saved['activeRun']['token'] = 'new'; bridge.write(self.root / 'state.json', saved)
        self.assertEqual(bridge.heartbeat('old')['result'], 'expired_batch')
        self.assertNotIn('lastProgressAt', bridge.state()['activeRun'])
        with self.assertRaisesRegex(ValueError, 'token'):
            bridge.heartbeat(None)

    def test_progress_keeps_a_long_repair_run_leased(self):
        saved = bridge.state()
        saved['activeRun'] = {'startedAt': '2026-10-04T10:00:00Z', 'token': 'batch1', 'receipt': {'run': {'id': 'run1'}}}
        bridge.write(self.root / 'state.json', saved)
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        current = '2026-10-04T12:00:00Z'
        result = {'ok': True, 'result': {'runs': [{'id': 'run1', 'status': 'dispatched'}]}}
        epoch = bridge.datetime.fromisoformat(current.replace('Z', '+00:00')).timestamp()
        with patch.object(bridge, 'now', return_value=current), patch.object(bridge.time, 'time', return_value=epoch), patch.object(bridge, 'command', return_value=json.dumps(result)):
            self.assertEqual(bridge.heartbeat('batch1')['result'], 'progress_recorded')
            self.assertTrue(bridge.inspect_active_run())
        with patch.object(bridge.time, 'time', return_value=epoch + 1801), patch.object(bridge, 'command', return_value=json.dumps(result)), patch.object(bridge, 'wake'):
            self.assertFalse(bridge.inspect_active_run())
        self.assertIsNone(bridge.state()['activeRun'])

    def test_three_failed_attempts_require_review(self):
        saved = bridge.state(); saved['activeRun'] = None; saved['items']['key']['attempts'] = 3
        bridge.write(self.root / 'state.json', saved)
        with patch.object(bridge, 'command') as run:
            bridge.dispatch()
        self.assertFalse(run.called)
        self.assertEqual(bridge.state()['items']['key']['status'], 'needs_review')

    def test_monitor_rechecks_a_heartbeat_recorded_during_the_cli_call(self):
        saved = bridge.state()
        saved['activeRun'] = {'startedAt': '2026-10-04T10:00:00Z', 'token': 'batch1', 'receipt': {'run': {'id': 'run1'}}}
        bridge.write(self.root / 'state.json', saved)
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        current = '2026-10-04T12:00:00Z'
        epoch = bridge.datetime.fromisoformat(current.replace('Z', '+00:00')).timestamp()
        def concurrent_heartbeat(*args, **kwargs):
            bridge.heartbeat('batch1')
            return json.dumps({'ok': True, 'result': {'runs': [{'id': 'run1', 'status': 'dispatched'}]}})
        with patch.object(bridge, 'now', return_value=current), patch.object(bridge.time, 'time', return_value=epoch), patch.object(bridge, 'command', side_effect=concurrent_heartbeat), patch.object(bridge, 'wake') as signal:
            self.assertTrue(bridge.inspect_active_run())
            self.assertFalse(signal.called)
        self.assertEqual(bridge.state()['activeRun']['lastProgressAt'], current)

    def test_finished_run_is_released_even_with_a_concurrent_heartbeat(self):
        saved = bridge.state()
        saved['activeRun'] = {'startedAt': '2026-10-04T10:00:00Z', 'token': 'batch1', 'receipt': {'run': {'id': 'run1'}}}
        saved['items']['key']['runToken'] = 'batch1'
        bridge.write(self.root / 'state.json', saved)
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        def concurrent_heartbeat(*args, **kwargs):
            bridge.heartbeat('batch1')
            return json.dumps({'ok': True, 'result': {'runs': [{'id': 'run1', 'status': 'completed'}]}})
        with patch.object(bridge, 'command', side_effect=concurrent_heartbeat), patch.object(bridge, 'wake'):
            self.assertFalse(bridge.inspect_active_run())
        self.assertIsNone(bridge.state()['activeRun'])
        self.assertEqual(bridge.state()['items']['key']['status'], 'needs_review')

    def test_recording_a_decision_refreshes_the_matching_batch(self):
        saved = bridge.state(); saved['activeRun']['token'] = 'batch1'
        saved['items']['key']['runToken'] = 'batch1'; bridge.write(self.root / 'state.json', saved)
        bridge.finish('key', 'Verified repair', run_token='batch1')
        self.assertIn('lastProgressAt', bridge.state()['activeRun'])

    def test_paginated_catchup_advances_cursor_and_keeps_all_ids(self):
        first = {'value': [{'id': 'mail1', 'subject': '[stablyai/orca] reply', 'receivedDateTime': '2026-10-04T15:00:00Z'}],
                 '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=100'}
        second = {'value': [{'id': 'mail2', 'subject': '[brooksgolden/Orca-Agency] reply', 'receivedDateTime': '2026-10-04T15:01:00Z'}]}
        inbox = queue.Queue()
        with patch.object(bridge, 'command', side_effect=[json.dumps(first), json.dumps(second)]):
            bridge.catch_up(inbox, {'startAt': '2026-10-04T14:00:00Z'})
        self.assertEqual([inbox.get(), inbox.get()], ['mail1', 'mail2'])
        self.assertEqual(bridge.state()['catchUpAt'], '2026-10-04T15:01:00Z')

    def test_known_duplicate_after_uncertain_post_is_recorded_not_reposted(self):
        saved = bridge.state(); saved['items']['key']['postAttemptAt'] = 'earlier'; bridge.write(self.root / 'state.json', saved)
        reply = self.root / 'reply.md'; reply.write_text('Thanks.')
        duplicate = {'user': {'login': 'brooksgolden'}, 'body': '<!-- orca-agency-email:key -->', 'html_url': 'known'}
        with patch.object(bridge, 'gh', side_effect=[{'user': {'login': 'brooksgolden'}}, [duplicate]]) as api:
            bridge.finish('key', 'Already posted', str(reply))
        self.assertEqual(api.call_count, 2)
        self.assertEqual(bridge.state()['items']['key']['replyUrl'], 'known')

    def test_malformed_tool_output_does_not_discard_notification(self):
        with patch.object(bridge, 'command', return_value=''), patch.object(bridge.time, 'sleep'):
            with self.assertRaises(json.JSONDecodeError):
                bridge.process_event('valid-email')
        self.assertEqual(next(iter(bridge.state()['events'].values()))['status'], 'retry_needed')

    def test_explicit_invalid_sender_is_ignored_once(self):
        with patch.object(bridge, 'enqueue_email', side_effect=bridge.IgnoreNotification('Other sender')) as enqueue:
            bridge.process_event('other-email'); bridge.process_event('other-email')
        self.assertEqual(enqueue.call_count, 1)
        self.assertEqual(next(iter(bridge.state()['events'].values()))['status'], 'processed')

    def test_orca_unavailable_does_not_use_review_attempts(self):
        saved = bridge.state(); saved['activeRun'] = None; bridge.write(self.root / 'state.json', saved)
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        with patch.object(bridge, 'command', side_effect=RuntimeError('Orca not running')):
            for _ in range(4):
                with self.assertRaises(RuntimeError):
                    bridge.dispatch()
        self.assertEqual(bridge.state()['items']['key'].get('attempts', 0), 0)
        self.assertEqual(bridge.state()['items']['key']['status'], 'pending')

    def test_only_accepted_run_counts_as_an_attempt(self):
        saved = bridge.state(); saved['activeRun'] = None; bridge.write(self.root / 'state.json', saved)
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        result = {'ok': True, 'result': {'run': {'id': 'r1', 'status': 'dispatched'}}}
        with patch.object(bridge, 'command', return_value=json.dumps(result)):
            bridge.dispatch()
        self.assertEqual(bridge.state()['items']['key']['attempts'], 1)
        self.assertEqual(bridge.state()['activeRun']['receipt']['run']['id'], 'r1')

    def test_missing_receipt_is_released_without_reposting(self):
        saved = bridge.state(); saved['activeRun'] = {'startedAt': '2026-10-04T14:00:00Z', 'token': 'lost'}
        saved['items']['key']['runToken'] = 'lost'; bridge.write(self.root / 'state.json', saved)
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        with patch.object(bridge.time, 'time', return_value=1791122700), patch.object(bridge, 'command', return_value=json.dumps({'ok': True, 'result': {'runs': []}})), patch.object(bridge, 'wake'):
            self.assertFalse(bridge.inspect_active_run())
        self.assertIsNone(bridge.state()['activeRun'])
        self.assertEqual(bridge.state()['items']['key']['status'], 'needs_review')

    def test_uncertain_receipts_keep_lease_and_do_not_launch_again(self):
        cases = [subprocess.TimeoutExpired('orca', 90), '',
                 json.dumps({'ok': True, 'result': {}}),
                 json.dumps({'ok': True, 'result': None})]
        bridge.write(self.root / 'config.json', {'orcaExecutable': 'orca', 'automationId': 'a1'})
        for case in cases:
            with self.subTest(case=type(case).__name__):
                saved = bridge.state(); saved['activeRun'] = None; saved['items']['key']['status'] = 'pending'
                saved['items']['key']['attempts'] = 0; bridge.write(self.root / 'state.json', saved)
                options = {'side_effect': case} if isinstance(case, Exception) else {'return_value': case}
                with patch.object(bridge, 'command', **options) as run:
                    bridge.dispatch(); bridge.dispatch()
                self.assertEqual(run.call_count, 1)
                self.assertEqual(bridge.state()['activeRun']['state'], 'dispatching')
                self.assertEqual(bridge.state()['items']['key']['attempts'], 0)


if __name__ == '__main__':
    unittest.main()
