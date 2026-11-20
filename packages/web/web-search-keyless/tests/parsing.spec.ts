/**
 * Parsing over recorded pages: the DuckDuckGo results and challenge pages were recorded from
 * html.duckduckgo.com (the results page with synthetic ad, redirect, duplicate, and unmarked-ad
 * blocks spliced in); the JSON answers follow the documented Marginalia and SearXNG shapes.
 */

import { describe, expect, it } from 'vitest'
import { isChallengePage, parseDuckDuckGoResults, resolveResultUrl } from '../src/duckduckgo.ts'
import { classesOf, decodeEntities, innerHtml, openingTags, parseAttributes, textOf } from '../src/html.ts'
import { readJsonResults } from '../src/results.ts'
import { fixture } from './server.ts'

describe('HTML helpers', () => {
  it('scans opening tags with quoted, unquoted, bare, and repeated attributes, skipping comments', () => {
    const tags = openingTags('<!-- <a href="hidden"> --><A HREF=\'/x\' data-x=1 hidden class="a  b" class="c"><span title="a > b">t</span></A>')
    expect(tags.map(tag => tag.name)).toEqual(['a', 'span'])
    expect(Object.fromEntries(tags[0]!.attributes)).toEqual({ 'href': '/x', 'data-x': '1', 'hidden': '', 'class': 'a  b' })
    expect(classesOf(tags[0]!)).toEqual(['a', 'b'])
    expect(classesOf(tags[1]!)).toEqual([])
    expect(tags[1]!.attributes.get('title')).toBe('a > b')
  })

  it('decodes attribute values', () => {
    expect(parseAttributes('href="/l/?a=1&amp;b=2"').get('href')).toBe('/l/?a=1&b=2')
  })

  it('reads inner markup up to the close tag, or nothing for an unclosed element', () => {
    const html = '<a class="x">One <b>two</b></A> tail'
    const [link] = openingTags(html)
    expect(innerHtml(html, link!)).toBe('One <b>two</b>')
    const open = '<a class="x">never closed'
    expect(innerHtml(open, openingTags(open)[0]!)).toBeUndefined()
  })

  it('strips tags and comments, decodes, and collapses whitespace', () => {
    expect(textOf('  <b>Cordis</b>&nbsp;&amp; <!-- c --> <i>friends</i>\n ')).toBe('Cordis & friends')
  })

  it('decodes numeric and named references, keeping unknown or invalid ones', () => {
    expect(decodeEntities('&#x27;&#39;&#X41;&hellip;&AMP;&unknown;&#0;&#x110000;')).toBe('\'\'A…&&unknown;&#0;&#x110000;')
  })
})

describe('DuckDuckGo results page', () => {
  it('reads organic results in page order, skipping ads, unmarked ad links, and repeated URLs', () => {
    expect(parseDuckDuckGoResults(fixture('duckduckgo-results.html'))).toEqual([
      {
        url: 'https://github.com/cordiverse/cordis',
        title: 'GitHub - cordiverse/cordis: Meta-Framework of Spatiotemporal ...',
        snippet: 'Meta-Framework of Spatiotemporal Composability. Contribute to cordiverse/cordis development by creating an account on GitHub.',
      },
      {
        url: 'https://floatboat.ai/blog/cordis-plugin-framework',
        title: 'Cordis Plugin Framework: Services Inside Stitch｜Floatboat',
        snippet: 'Cordis under Stitch connects contexts, services, effects, and events. Examine dependency injection, isolation, hot reload, and when a plugin system suits an agent.',
      },
      {
        url: 'https://cordis.example.org/guide?page=1&lang=en',
        title: 'Cordis & Friends \'Guide\' …',
        snippet: 'A guide with extra whitespace and entities <tags>.',
      },
      {
        url: 'https://deepseekai.works/cordis/',
        title: 'Cordis Framework: The Plugin Kernel Behind Stitch',
        snippet: 'See how Cordis, a TypeScript meta-framework born in 2019, ended up powering Stitch — plugins, fibers, and revertible effects explained.',
      },
    ])
  })

  it('omits a blank title and a missing snippet, and skips a block without a title link', () => {
    const html = '<div id="links">'
      + '<div class="result"><a class="result__a" href="https://a.test/"> <b></b> </a></div>'
      + '<div class="result"><a class="result__url" href="https://b.test/">no title link</a></div>'
      + '<div class="result"><a class="result__a">no href</a></div>'
      + '<div class="result"><a class="result__a" href="https://d.test/">D</a><a class="result__snippet">never closed</div>'
      + '<div class="result"><a class="result__a" href="https://c.test/">C</div>'
      + '</div>'
    expect(parseDuckDuckGoResults(html)).toEqual([{ url: 'https://a.test/' }, { url: 'https://d.test/', title: 'D' }, { url: 'https://c.test/' }])
  })

  it('reads a results page that found nothing as no results', () => {
    expect(parseDuckDuckGoResults(fixture('duckduckgo-no-results.html'))).toEqual([])
    expect(parseDuckDuckGoResults('<div class="no-results">No results.</div>')).toEqual([])
  })

  it('reads a page of ads only as no results', () => {
    expect(parseDuckDuckGoResults('<div class="result result--ad"><a class="result__a" href="https://ad.test/">Ad</a></div>')).toEqual([])
  })

  it('rejects a page that is not a results page', () => {
    expect(() => parseDuckDuckGoResults('<html><body><p>Something else</p></body></html>'))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'DuckDuckGo returned a page without recognizable results' }))
  })

  it('recognizes the recorded bot challenge page', () => {
    expect(isChallengePage(fixture('duckduckgo-challenge.html'))).toBe(true)
    expect(isChallengePage(fixture('duckduckgo-results.html'))).toBe(false)
  })
})

describe('DuckDuckGo result links', () => {
  it('keeps a direct http(s) link', () => {
    expect(resolveResultUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(resolveResultUrl('http://example.com/')).toBe('http://example.com/')
  })

  it('decodes the /l/ redirect, protocol-relative or absolute', () => {
    expect(resolveResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx%3Fy%3D1&rut=abc')).toBe('https://example.com/x?y=1')
    expect(resolveResultUrl('https://html.duckduckgo.com/l/?uddg=http%3A%2F%2Fexample.org%2F')).toBe('http://example.org/')
    expect(resolveResultUrl('/l/?uddg=https%3A%2F%2Frelative.example%2F')).toBe('https://relative.example/')
  })

  it('drops ads, other DuckDuckGo links, unusable redirect targets, and non-web links', () => {
    expect(resolveResultUrl('https://duckduckgo.com/y.js?ad_domain=x.test&u3=https%3A%2F%2Fx.test')).toBeUndefined()
    expect(resolveResultUrl('//duckduckgo.com/l/?rut=abc')).toBeUndefined()
    expect(resolveResultUrl('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)')).toBeUndefined()
    expect(resolveResultUrl('mailto:someone@example.com')).toBeUndefined()
    expect(resolveResultUrl('http://[broken')).toBeUndefined()
  })
})

describe('JSON answers', () => {
  it('maps Marginalia results, skipping entries without a web URL and repeats', () => {
    expect(readJsonResults('Marginalia', fixture('marginalia.json'), { snippet: 'description' })).toEqual([
      { url: 'https://cordis.example.org/docs/plugins.html', title: 'Writing Cordis plugins', snippet: 'How a plugin declares services and effects.' },
      { url: 'https://blog.example.net/2019/plugin-frameworks' },
      { url: 'https://wiki.example.com/Cordis', title: 'Cordis - Wiki', snippet: 'Encyclopedic entry.' },
    ])
  })

  it('maps SearXNG results with their publication time', () => {
    expect(readJsonResults('SearXNG', fixture('searxng.json'), { snippet: 'content', publishedAt: 'publishedDate' })).toEqual([
      { url: 'https://github.com/cordiverse/cordis', title: 'GitHub - cordiverse/cordis', snippet: 'Meta-Framework of Spatiotemporal Composability.' },
      { url: 'https://news.example.com/cordis-release', title: 'Cordis 4 released', publishedAt: '2026-03-01T00:00:00' },
    ])
  })

  it('rejects a body that is not JSON or has no results list', () => {
    expect(() => readJsonResults('Marginalia', 'Daily Limit Exceeded', { snippet: 'description' }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Marginalia returned a body that is not JSON' }))
    expect(() => readJsonResults('SearXNG', '{"results":{}}', { snippet: 'content' }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'SearXNG returned JSON without a results list' }))
    expect(() => readJsonResults('SearXNG', '[]', { snippet: 'content' }))
      .toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})
