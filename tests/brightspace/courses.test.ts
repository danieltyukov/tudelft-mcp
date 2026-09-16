import { describe, expect, it } from 'vitest';
import { parseCourse } from '../../src/brightspace/courses.js';

describe('parseCourse', () => {
  it('parses TU Delft course codes into code, year and period', () => {
    const course = parseCourse({
      OrgUnit: {
        Id: 774356,
        Type: { Id: 3 },
        Name: 'Circuit Fundamentals',
        Code: 'CESE5040+2025+4',
        HomeUrl: '/d2l/home/774356',
      },
      Access: {
        IsActive: true,
        CanAccess: true,
        StartDate: '2026-02-01T00:00:00.000Z',
        EndDate: null,
        ClasslistRoleName: 'Student',
      },
      PinDate: null,
    });
    expect(course).toMatchObject({
      id: '774356',
      courseCode: 'CESE5040',
      academicYear: '2025-2026',
      period: 'Q4',
      role: 'Student',
      pinned: false,
      isOrganisation: false,
    });
    expect(course?.url).toBe('https://brightspace.tudelft.nl/d2l/home/774356');
  });
  it('flags organisation units', () => {
    expect(
      parseCourse({ OrgUnit: { Id: 1, Name: 'EEMCS', Code: 'EWI+ORG' }, Access: {} })?.isOrganisation,
    ).toBe(true);
  });
});

describe('parseCourse codes', () => {
  it('accepts codes with a single digit before letters', () => {
    const course = parseCourse({
      OrgUnit: { Id: 5, Name: 'Transistor Circuits', Code: 'EE2C1+2026+1' },
      Access: { IsActive: true, CanAccess: true },
    });
    expect(course).toMatchObject({ courseCode: 'EE2C1', academicYear: '2026-2027', period: 'Q1' });
  });
});
