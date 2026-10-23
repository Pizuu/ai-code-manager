import { test } from 'node:test';
import assert from 'node:assert/strict';
import { languageFor, tokenizeLine } from '../../../../src/frontend/lib/highlight.ts';

test('languageFor maps extensions and dotfiles', () => {
  assert.equal(languageFor('src/a.ts'), 'ts');
  assert.equal(languageFor('package.json'), 'json');
  assert.equal(languageFor('scripts/verify.sh'), 'sh');
  assert.equal(languageFor('.gitignore'), 'sh');
  assert.equal(languageFor('LICENSE'), 'plain');
});

test('tokenizes keywords, strings, numbers and line comments', () => {
  const { tokens } = tokenizeLine("const a = 'x'; // note 1", 'ts');
  assert.deepEqual(tokens.filter((t) => t.t).map((t) => [t.t, t.v]), [['kw', 'const'], ['str', "'x'"], ['com', '// note 1']]);
  assert.equal(tokens.map((t) => t.v).join(''), "const a = 'x'; // note 1");
  assert.deepEqual(tokenizeLine('x = 42', 'py').tokens.find((t) => t.t === 'num'), { t: 'num', v: '42' });
});

test('block comments carry over to the next line', () => {
  const first = tokenizeLine('a /* start', 'ts');
  assert.equal(first.state.inBlock, true);
  const second = tokenizeLine('still */ b', 'ts', first.state);
  assert.deepEqual(second.tokens[0], { t: 'com', v: 'still */' });
  assert.equal(second.state.inBlock, false);
});

test('plain text is a single untyped token', () => {
  assert.deepEqual(tokenizeLine('hello', 'plain').tokens, [{ t: null, v: 'hello' }]);
});
