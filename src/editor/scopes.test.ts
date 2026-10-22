import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { findSymbols, scanBlocks, symbolForActions } from './scopes'
import { outline } from '../plugins/context'

const CSHARP = `using UnityEngine;

namespace Game
{
	public class Player : MonoBehaviour
	{
		[SerializeField] float speed = 4f;
		string label = "not { a block";
		char brace = '{';

		/// Moves the player.
		[ContextMenu("Move")]
		public void Move(Vector3 dir)
		{
			if (dir == Vector3.zero)
			{
				return;
			}
			var path = @"C:\\{weird}";
			transform.position += dir * speed; // { ignored
		}

		public int Health
		{
			get { return 3; }
		}

		void Jump() {
			Debug.Log("jump");
		}
	}
}
`

const parse = (src: string) => {
  const doc = Text.of(src.split('\n'))
  const blocks = scanBlocks(src, 'c')
  return { doc, blocks, symbols: findSymbols(doc, blocks) }
}

describe('scanBlocks', () => {
  it('ignores braces in strings, chars and comments', () => {
    const { blocks } = parse(CSHARP)
    // namespace, class, Move, if, Health, Jump
    expect(blocks.map((b) => b.openLine)).toEqual([4, 6, 14, 16, 24, 28])
    expect(blocks.map((b) => b.depth)).toEqual([0, 1, 2, 3, 2, 2])
  })

  it('treats single quotes as strings in JS', () => {
    const blocks = scanBlocks("const a = '{'\nfunction f() {\n  return 1\n}\n", 'js')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].openLine).toBe(2)
  })

  it('steps over Rust lifetimes', () => {
    const blocks = scanBlocks("fn f<'a>(x: &'a str) {\n    x\n}\n", 'c')
    expect(blocks).toHaveLength(1)
  })
})

describe('findSymbols', () => {
  it('names declarations in both brace styles', () => {
    const { symbols } = parse(CSHARP)
    expect(symbols.map((s) => `${s.kind} ${s.name}`)).toEqual([
      'namespace Game',
      'class Player',
      'method Move',
      'property Health',
      'method Jump'
    ])
  })

  it('includes attributes and doc comments in a symbol', () => {
    const { doc, symbols } = parse(CSHARP)
    const move = symbols.find((s) => s.name === 'Move')!
    expect(doc.lineAt(move.from).number).toBe(11)
    expect(move.parent?.name).toBe('Player')
  })

  it('picks the method around the cursor for actions', () => {
    const { doc, symbols } = parse(CSHARP)
    const insideIf = doc.line(18).from
    expect(symbolForActions(symbols, insideIf)?.name).toBe('Move')
  })

  it('ignores lambdas passed as arguments', () => {
    const src = 'class A {\n  run() {\n    items.forEach((x) => {\n      go(x)\n    })\n  }\n}\n'
    const { symbols } = parse(src)
    expect(symbols.map((s) => s.name)).toEqual(['A', 'run'])
  })
})

const PYTHON = `import math

class Ship(Base):
    speed = 3

    @property
    def heading(self):
        return self._heading

    def move(self, dx,
             dy):
        if dx > 0:
            self.x += dx  # go right:
        self.y += dy

def main():
    Ship().move(1, 2)
`

describe('python', () => {
  const parsePy = (src: string) => {
    const doc = Text.of(src.split('\n'))
    const blocks = scanBlocks(src, 'indent')
    return { doc, blocks, symbols: findSymbols(doc, blocks) }
  }

  it('finds blocks by indentation, including multi-line headers', () => {
    const { blocks } = parsePy(PYTHON)
    expect(blocks.map((b) => [b.openLine, b.closeLine, b.depth])).toEqual([
      [3, 14, 0],
      [7, 8, 1],
      [10, 14, 1],
      [12, 13, 2],
      [16, 17, 0]
    ])
  })

  it('names classes and functions, with decorators attached', () => {
    const { doc, symbols } = parsePy(PYTHON)
    expect(symbols.map((s) => `${s.kind} ${s.name}`)).toEqual([
      'class Ship',
      'function heading',
      'function move',
      'function main'
    ])
    const heading = symbols.find((s) => s.name === 'heading')!
    expect(doc.lineAt(heading.from).number).toBe(6)
    expect(heading.parent?.name).toBe('Ship')
  })

  it('outlines a class without bodies or braces', () => {
    const { doc, symbols } = parsePy(PYTHON)
    const ship = symbols.find((s) => s.name === 'Ship')!
    const text = outline(doc, ship, symbols)
    expect(text).toContain('class Ship(Base):')
    expect(text).toContain('speed = 3')
    expect(text).toContain('def heading(self): …')
    expect(text).not.toContain('return self._heading')
    expect(text).not.toContain('{')
  })
})

describe('outline', () => {
  it('keeps fields and signatures but drops bodies', () => {
    const { doc, symbols } = parse(CSHARP)
    const player = symbols.find((s) => s.name === 'Player')!
    const text = outline(doc, player, symbols)
    expect(text).toContain('[SerializeField] float speed = 4f;')
    expect(text).toContain('public void Move(Vector3 dir) { … }')
    expect(text).toContain('void Jump() { … }')
    expect(text).not.toContain('transform.position')
  })
})
