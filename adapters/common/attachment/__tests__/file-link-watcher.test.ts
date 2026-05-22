import { describe, it, expect } from 'bun:test'
import { FileLinkWatcher } from '../file-link-watcher.js'

describe('FileLinkWatcher', () => {
  it('extracts absolute local markdown links', () => {
    const w = new FileLinkWatcher()
    const out = w.feed('See [report](/tmp/report.pdf).')
    expect(out.length).toBe(1)
    expect(out[0]!.source.path).toBe('/tmp/report.pdf')
    expect(out[0]!.source.mime).toBe('application/pdf')
    expect(out[0]!.label).toBe('report')
  })

  it('extracts file URLs as paths', () => {
    const w = new FileLinkWatcher()
    const out = w.feed('[sheet](file:///tmp/a%20b.xlsx)')
    expect(out.length).toBe(1)
    expect(out[0]!.source.path).toBe('/tmp/a b.xlsx')
  })

  it('skips image markdown blocks and web links', () => {
    const w = new FileLinkWatcher()
    const out = w.feed('![image](/tmp/a.png) and [docs](https://example.com)')
    expect(out.length).toBe(0)
  })

  it('handles links split across feed boundaries', () => {
    const w = new FileLinkWatcher()
    expect(w.feed('open [re').length).toBe(0)
    const out = w.feed('port](/tmp/out.csv)')
    expect(out.length).toBe(1)
    expect(out[0]!.source.path).toBe('/tmp/out.csv')
  })

  it('deduplicates repeated paths until reset', () => {
    const w = new FileLinkWatcher()
    expect(w.feed('[a](/tmp/a.txt)').length).toBe(1)
    expect(w.feed('[again](/tmp/a.txt)').length).toBe(0)
    w.reset()
    expect(w.feed('[a](/tmp/a.txt)').length).toBe(1)
  })
})
