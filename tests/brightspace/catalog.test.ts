import { describe, expect, it } from 'vitest';
import { parseCatalogItem } from '../../src/brightspace/catalog.js';

describe('parseCatalogItem', () => {
  it('splits code, title and semester from a Discover list entry', () => {
    const item = parseCatalogItem(
      '  EE2C1 Transistor Circuits (2026/27 Q1) Click to view activity ',
      '/d2l/le/discovery/view/course/844493',
      'https://brightspace.tudelft.nl',
    );
    expect(item).toEqual({
      courseId: '844493',
      courseCode: 'EE2C1',
      title: 'Transistor Circuits',
      semester: '2026/27 Q1',
      url: 'https://brightspace.tudelft.nl/d2l/le/discovery/view/course/844493',
    });
  });
  it('keeps entries without a recognisable code and drops entries without a course link', () => {
    expect(
      parseCatalogItem('Introduction week', '/d2l/le/discovery/view/course/12', 'https://x')?.title,
    ).toBe('Introduction week');
    expect(parseCatalogItem('Something', '/d2l/le/discovery/view/search', 'https://x')).toBeUndefined();
    expect(parseCatalogItem('Something', null, 'https://x')).toBeUndefined();
  });
});
