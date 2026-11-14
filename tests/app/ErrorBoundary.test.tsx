import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '../../src/app/ErrorBoundary';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function BrokenScreen(): never {
  throw new Error('Failed to render');
}

it('replaces a failed screen with an accessible recovery action', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <ErrorBoundary>
      <BrokenScreen />
    </ErrorBoundary>,
  );
  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  expect(screen.getByRole('button', { name: 'Reload app' })).toBeEnabled();
});
