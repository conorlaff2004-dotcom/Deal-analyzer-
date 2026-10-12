const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRss } = require('../scripts/news.js');

test('parses Google News RSS items, strips source suffix, dedupes', () => {
  const xml = `<rss><channel>
    <item><title>Belfast rents rise 10% &amp; more - BBC News</title><link>https://news.google.com/a</link>
      <pubDate>Mon, 06 Oct 2026 08:00:00 GMT</pubDate><source url="https://bbc.co.uk">BBC News</source></item>
    <item><title><![CDATA[Landlords face new rules - Irish Times]]></title><link>https://news.google.com/b</link>
      <pubDate>Tue, 07 Oct 2026 08:00:00 GMT</pubDate><source url="https://irishtimes.com">Irish Times</source></item>
    <item><title>Belfast rents rise 10% &amp; more - Belfast Live</title><link>https://news.google.com/c</link>
      <pubDate>Mon, 06 Oct 2026 09:00:00 GMT</pubDate><source url="https://belfastlive.co.uk">Belfast Live</source></item>
  </channel></rss>`;
  const items = parseRss(xml);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Landlords face new rules');
  assert.equal(items[1].title, 'Belfast rents rise 10% & more');
  assert.equal(items[1].source, 'BBC News');
});
