"""Decode the same Composio realtime envelopes supported by its CLI."""
import json
import time


def decoded(value):
    return json.loads(value) if isinstance(value, str) else value


def message_id(payload, config):
    payload = decoded(payload)
    metadata = payload.get('metadata', {})
    data = payload.get('data', {})
    if payload.get('type') == 'composio.trigger.message':
        identifier = metadata.get('trigger_id')
        owner = metadata.get('connected_account_id')
        slug = metadata.get('trigger_slug')
    elif data.get('trigger_nano_id'):
        identifier = data['trigger_nano_id']
        owner = data.get('connection_nano_id')
        slug = payload.get('type', '').upper()
    elif payload.get('trigger_name'):
        identifier = payload.get('trigger_id')
        owner = payload.get('connection_id')
        slug = payload['trigger_name']
        data = payload.get('payload', {})
    else:
        identifier = metadata.get('nanoId')
        owner = metadata.get('connection', {}).get('connectedAccountNanoId')
        slug = metadata.get('triggerName')
        data = payload.get('payload', {})
    if (identifier != config['triggerId'] or owner != config['connectedAccountId']
            or slug != 'OUTLOOK_MESSAGE_TRIGGER'):
        return None
    message = data.get('outlook_message') or data.get('message') or data
    identifier = message.get('id')
    return identifier if isinstance(identifier, str) and 0 < len(identifier) < 2000 else None


class Chunks:
    def __init__(self):
        self.pending = {}

    def add(self, value):
        value = decoded(value)
        current_time = time.monotonic()
        self.pending = {key: item for key, item in self.pending.items()
                        if current_time - item['at'] < 60}
        identifier, index = value.get('id'), value.get('index')
        chunk = value.get('chunk')
        if (not isinstance(identifier, str) or not isinstance(index, int)
                or not 0 <= index <= 1000 or not isinstance(chunk, str)):
            return None
        if identifier not in self.pending:
            if len(self.pending) >= 100:
                del self.pending[next(iter(self.pending))]
            self.pending[identifier] = {'at': current_time, 'parts': {}, 'last': None}
        item = self.pending[identifier]
        item['parts'][index] = chunk
        if value.get('final'):
            item['last'] = index
        if sum(len(part) for part in item['parts'].values()) > 2_000_000:
            del self.pending[identifier]
            return None
        last = item['last']
        if last is not None and all(i in item['parts'] for i in range(last + 1)):
            text = ''.join(item['parts'][i] for i in range(last + 1))
            del self.pending[identifier]
            return json.loads(text)
        return None
