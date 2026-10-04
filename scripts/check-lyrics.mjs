import test from 'node:test'
import assert from 'node:assert/strict'
import { activeLyricIndex, parseLrc } from '../src/lyrics.ts'

test('LRC accepts common fractional stamps, offsets, and multiple timestamps on one row', () => {
  const lines = parseLrc('\uFEFF[ar:Artist]\r\n[offset:+250]\r\n[00:01]第一句\r\n[00:02.5][00:03.25][00:04.125]第二句')
  assert.deepEqual(lines, [
    { time: 1.25, text: '第一句' },
    { time: 2.75, text: '第二句' },
    { time: 3.5, text: '第二句' },
    { time: 4.375, text: '第二句' },
  ])
})

test('LRC clamps negative offset times, ignores metadata-only rows, and keeps lyric markup as text', () => {
  const lines = parseLrc('[ti:Album]\n[offset:-9000]\n[00:02.00]\n[00:01.00]<b>safe text</b>')
  assert.deepEqual(lines, [{ time: 0, text: '<b>safe text</b>' }])
})

test('active lyric lookup uses binary-search boundary semantics', () => {
  const lines = parseLrc('[00:01]A\n[00:03]B\n[00:05]C')
  assert.equal(activeLyricIndex(lines, 0.99), -1)
  assert.equal(activeLyricIndex(lines, 1), 0)
  assert.equal(activeLyricIndex(lines, 4.9), 1)
  assert.equal(activeLyricIndex(lines, 5), 2)
})
