import assert from 'node:assert/strict';
import test from 'node:test';
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { normalizeLocationSearchResponse } from '../src/locationSearch.ts';
import { ErrorBoundary } from '../src/components/ErrorBoundary.tsx';

const newDelhi = {
  id: 1, name: 'New Delhi', country: 'India', country_code: 'IN', admin1: 'Delhi',
  latitude: 28.6139, longitude: 77.209,
};

test('keeps the current list response and every candidate', () => {
  const response = normalizeLocationSearchResponse({ results: [newDelhi, { ...newDelhi, id: 2, name: 'New Delhi District' }] });
  assert.equal(response.results.length, 2);
  assert.equal(response.results[0].country, 'India');
  assert.equal(response.results[0].latitude, 28.6139);
});

test('normalizes a legacy single-location response to one candidate', () => {
  const response = normalizeLocationSearchResponse(newDelhi);
  assert.deepEqual(response.results, [newDelhi]);
});

test('rejects malformed responses with a useful error instead of exposing undefined results', () => {
  assert.throws(() => normalizeLocationSearchResponse({ name: 'New Delhi' }), /invalid response/i);
  assert.throws(() => normalizeLocationSearchResponse({ results: [null] }), /invalid response/i);
});

test('represents a valid no-result response as an empty list', () => {
  assert.deepEqual(normalizeLocationSearchResponse({ results: [] }), { results: [] });
});

test('error boundary shows a recoverable fallback and reload action', () => {
  const boundary = new ErrorBoundary({ children: null });
  boundary.state = ErrorBoundary.getDerivedStateFromError();
  const fallback = boundary.render();
  assert.ok(isValidElement(fallback));
  const section = Children.toArray((fallback as ReactElement<{ children: ReactNode }>).props.children)[0];
  assert.ok(isValidElement(section));
  assert.equal((section as ReactElement<{ role?: string }>).props.role, 'alert');
  const controls = Children.toArray((section as ReactElement<{ children: ReactNode }>).props.children);
  const retry = controls.find((element) => isValidElement(element) && element.type === 'button');
  assert.ok(retry);
  let reloaded = false;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload: () => { reloaded = true; } } } });
  try { (retry as ReactElement<{ onClick: () => void }>).props.onClick(); }
  finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    else Reflect.deleteProperty(globalThis, 'window');
  }
  assert.equal(reloaded, true);
});
