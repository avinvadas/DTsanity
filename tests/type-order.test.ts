import { describe, expect, it } from 'vitest';
import { orderStyles } from '../src/semantic/typography';

/** Order ids given in file order, with their font sizes (-1 when unknown). */
const order = (styles: [string, number][]) => orderStyles(styles.map(([id, px], i) => ({ id, px, order: i }))).map((x) => x.id);

describe('typography order', () => {
  it('puts display before headings, titles, body, labels, captions and code', () => {
    expect(
      order([
        ['type.caption', 12],
        ['type.code', 13],
        ['type.body.md', 16],
        ['type.label', 14],
        ['type.title', 22],
        ['type.h1', 40],
        ['type.display', 57],
        ['type.subtitle', 18],
      ]),
    ).toEqual(['type.display', 'type.h1', 'type.title', 'type.subtitle', 'type.body.md', 'type.label', 'type.caption', 'type.code']);
  });

  it('keeps display first even when it is smaller or its size is unknown', () => {
    expect(order([['heading.1', 48], ['heading.display', -1], ['body', 16]])).toEqual(['heading.display', 'heading.1', 'body']);
    expect(order([['headline.large', 32], ['display.small', 30]])).toEqual(['display.small', 'headline.large']);
  });

  it('orders heading levels from h1 down, whatever their sizes say', () => {
    expect(order([['heading.3', 18], ['heading.1', -1], ['heading.2', -1], ['h4', 16]])).toEqual(['heading.1', 'heading.2', 'heading.3', 'h4']);
    expect(order([['heading.2-fixed', 21], ['heading.1-fixed', 24]])).toEqual(['heading.1-fixed', 'heading.2-fixed']);
  });

  it('runs size words and numbered steps from largest to smallest', () => {
    expect(order([['body.sm', 14], ['body.xl', 21], ['body.2xs', 11], ['body.md', 16], ['body.2xl', 24]])).toEqual(['body.2xl', 'body.xl', 'body.md', 'body.sm', 'body.2xs']);
    expect(order([['title.small', 16], ['title.large', 32], ['title.medium', 20]])).toEqual(['title.large', 'title.medium', 'title.small']);
    expect(order([['heading.scale.100', 12], ['heading.scale.800', -1], ['heading.scale.400', 16]])).toEqual(['heading.scale.800', 'heading.scale.400', 'heading.scale.100']);
    expect(order([['heading-01', 14], ['heading-07', 42], ['heading-03', 20]])).toEqual(['heading-07', 'heading-03', 'heading-01']);
  });

  it('keeps each family together, in file order', () => {
    expect(
      order([
        ['typography.body.lg', 18],
        ['typography.body.md', 16],
        ['typography.body.short.lg', 18],
        ['typography.body.short.md', 16],
        ['typography.heading.md', 24],
      ]),
    ).toEqual(['typography.heading.md', 'typography.body.lg', 'typography.body.md', 'typography.body.short.lg', 'typography.body.short.md']);
  });

  it('falls back to font size, then file order, for names that say nothing', () => {
    expect(order([['brand.a', 14], ['brand.b', 30], ['brand.c', 30]])).toEqual(['brand.b', 'brand.c', 'brand.a']);
  });
});
