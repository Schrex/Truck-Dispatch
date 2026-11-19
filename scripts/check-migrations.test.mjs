import { describe, expect, it } from 'vitest';
import { migrationProblems } from './check-migrations.mjs';

describe('migrationProblems', () => {
  it('accepts numbered, distinct migrations', () => {
    expect(migrationProblems(['0001_a.sql', '0002_b.sql'])).toEqual([]);
  });
  it('refuses two migrations with the same number', () => {
    expect(migrationProblems(['0002_a.sql', '0002_b.sql'])).toHaveLength(1);
  });
  it('refuses a badly named migration', () => {
    expect(migrationProblems(['add-trucks.sql'])).toHaveLength(1);
  });
});
