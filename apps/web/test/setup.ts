import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement Element.prototype.scrollTo.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {
    /* no-op */
  };
}

afterEach(() => {
  cleanup();
});
