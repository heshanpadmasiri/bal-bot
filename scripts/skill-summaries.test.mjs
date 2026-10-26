import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversationItems } from '../apps/editor/src/tool-summaries.ts';

const assistant = (...content) => ({ role: 'assistant', content, stopReason: 'toolUse' });
const text = value => ({ type: 'text', text: value });
const skillCall = (id, name = 'flow-design') => ({ type: 'toolCall', id, name: 'read_skill', arguments: { name } });
const skillResult = (id, skillName = 'canonical-skill', isError = false, body = 'secret skill body') => ({
  role: 'toolResult', toolCallId: id, toolName: 'read_skill', content: [{ type: 'text', text: body }], isError, details: { skillName },
});

test('read_skill uses validated call names while running, failed, or stopped and canonical names on success', () => {
  const pending = assistant(skillCall('skill'));
  assert.equal(conversationItems([pending], true)[0].text, 'Using skill flow-design…');
  assert.equal(conversationItems([pending], false)[0].text, 'Stopped: use skill flow-design');
  assert.equal(conversationItems([{ ...pending, stopReason: 'error' }], true)[0].text,
    'Could not use skill flow-design. Operation could not be completed.');
  assert.equal(conversationItems([pending, { role: 'user', content: 'Next turn' }], true)[0].state, 'stopped');
  for (const stopReason of ['aborted', 'error']) {
    const [item] = conversationItems([{ ...pending, stopReason }, skillResult('skill')], false);
    assert.equal(item.state, 'completed');
    assert.equal(item.text, 'Using skill canonical-skill');
  }
  const [failed] = conversationItems([pending, skillResult('skill', 'wrong-name', true)], false);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.text, 'Could not use skill flow-design. Operation could not be completed.');
  const [stopped] = conversationItems([pending, skillResult('skill', 'wrong-name', true, 'Operation aborted')], false);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.text, 'Stopped: use skill flow-design');
});

test('read_skill partial and malformed names use safe generic summaries without raw arguments or bodies', () => {
  for (const name of [undefined, null, {}, [], 42, '', 'Secret', 'private/skill', 'secret body', '-skill', 'skill-', 'skill--name', 'skill\nbody']) {
    const pending = assistant({ ...skillCall('skill'), arguments: { name }, partialJson: '{"name":"secret body' });
    const invalidResult = { ...skillResult('skill'), details: { skillName: name } };
    assert.equal(conversationItems([pending], true)[0].text, 'Using skill…');
    assert.equal(conversationItems([pending], false)[0].text, 'Stopped: use skill');
    assert.equal(conversationItems([pending, invalidResult], false)[0].text, 'Using skill');
    assert.equal(conversationItems([pending, { ...invalidResult, isError: true }], false)[0].text,
      'Could not use skill. Operation could not be completed.');
  }
  for (const argumentsValue of [undefined, null, [], 'secret body', {}]) {
    assert.equal(conversationItems([assistant({ ...skillCall('skill'), arguments: argumentsValue })], true)[0].text, 'Using skill…');
  }
  for (const details of [undefined, null, {}, { skillName: 'secret body' }]) {
    const items = conversationItems([assistant(skillCall('skill')), { ...skillResult('skill'), details }], false);
    assert.equal(items[0].text, 'Using skill');
    assert.doesNotMatch(JSON.stringify(items), /secret|partialJson|arguments|details/);
  }
});

test('read_skill results preserve call ordering, handle orphans, and never expose skill content', () => {
  const messages = [assistant(text('Before'), skillCall('a'), text('Between'), skillCall('b', 'other-skill')),
    skillResult('b', 'second-skill'), skillResult('a', 'first-skill'), skillResult('orphan'), assistant(text('After'))];
  const before = structuredClone(messages);
  const items = conversationItems(messages, false);
  assert.deepEqual(items.map(item => item.kind === 'tool' ? item.text : item.message.content[0].text),
    ['Before', 'Using skill first-skill', 'Between', 'Using skill second-skill', 'Using skill canonical-skill', 'After']);
  assert.deepEqual(messages, before);
  assert.doesNotMatch(JSON.stringify(items), /secret|arguments|details/);
  assert.equal(conversationItems([skillResult('orphan', 'untrusted-name', true)], false)[0].text,
    'Could not use skill. Operation could not be completed.');
  assert.equal(conversationItems([skillResult('orphan', 'untrusted-name', true, 'Operation aborted')], false)[0].text,
    'Stopped: use skill');
  assert.equal(conversationItems([skillResult('a'), assistant(skillCall('a'))], false).length, 1);
});
