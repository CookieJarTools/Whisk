import { describe, expect, it } from 'vitest'
import { StringStream } from '@codemirror/language'
import { csharp } from '@codemirror/legacy-modes/mode/clike'
import { richClike } from './richClike'

const SRC = `using UnityEngine.Rendering;
namespace Game.Voxels
{
[SerializeField, Range(0, 1)]
public class VoxelChunk : MonoBehaviour
{
    private Vector3Int chunkSize;
    public const int MAX_SIZE = 16;
    public void SetVoxel(WorldVoxel voxel)
    {
        var local = GetLocalGridPosition(voxel.GridPosition);
        if (local == null) return;
        List<int> xs = new List<int>();
        this.chunkSize = Mathf.Max(1, MAX_SIZE);
        var s = $"x {local}";
        using (var scope = Open()) { }
    }
}
}`

/** Every non-space token as `text:style`, line by line. */
function tokens(src: string): Record<string, string> {
  const mode = richClike(csharp as never)
  const state = mode.startState!(4)
  const styles: Record<string, string> = {}
  for (const line of src.split('\n')) {
    const stream = new StringStream(line, 4, 4)
    while (!stream.eol()) {
      const style = mode.token(stream, state)
      const text = stream.current()
      if (text.trim() && !(text in styles)) styles[text] = String(style)
      stream.start = stream.pos
    }
  }
  return styles
}

describe('richClike', () => {
  const t = tokens(SRC)

  it('colours using and namespace paths as namespaces', () => {
    expect(t.UnityEngine).toBe('namespace')
    expect(t.Rendering).toBe('namespace')
    expect(t.Game).toBe('namespace')
    expect(t.Voxels).toBe('namespace')
    expect(t.scope).toBe('variableName.definition')
  })

  it('marks attributes', () => {
    expect(t.SerializeField).toBe('meta')
    expect(t.Range).toBe('meta')
  })

  it('finds types from context', () => {
    expect(t.VoxelChunk).toBe('typeName.definition')
    expect(t.MonoBehaviour).toBe('typeName')
    expect(t.Vector3Int).toBe('typeName')
    expect(t.WorldVoxel).toBe('typeName')
    expect(t.List).toBe('typeName')
    expect(t.Mathf).toBe('typeName')
  })

  it('finds methods and members', () => {
    expect(t.SetVoxel).toBe('variableName.function')
    expect(t.GetLocalGridPosition).toBe('variableName.function')
    expect(t.GridPosition).toBe('propertyName')
    expect(t.Max).toBe('propertyName.function')
  })

  it('splits keyword kinds and spots constants', () => {
    expect(t.public).toBe('keyword')
    expect(t.int).toBe('keyword')
    expect(t.if).toBe('controlKeyword')
    expect(t.return).toBe('controlKeyword')
    expect(t.this).toBe('self')
    expect(t.MAX_SIZE).toBe('variableName.constant')
    expect(t.$).toBe('string')
  })
})

describe('richClike state', () => {
  it('copies state for modes without their own copyState', () => {
    const mode = richClike(csharp as never)
    const state = mode.startState!(4)
    const copy = mode.copyState!(state)
    expect(copy).not.toBe(state)
    expect(copy.inner).not.toBe(state.inner)
  })
})
