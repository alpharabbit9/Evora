import path from 'node:path';

import express, { type RequestHandler } from 'express';

import { env } from '../config/env.js';
import { assertObjectKey } from './storage.js';

/**
 * Turning a stored `ProductImage.objectKey` into a URL a browser can load.
 *
 * The database holds keys, never URLs (`src/lib/storage.ts`), so the public origin can move
 * — local filesystem, MinIO, a CDN in front of R2 — without rewriting a single row. This is
 * the one place that knows where that origin is.
 */
const MEDIA_BASE_URL = (env.MEDIA_PUBLIC_URL ?? `${env.BETTER_AUTH_URL}/media`).replace(/\/+$/, '');

export function mediaUrl(objectKey: string): string {
  // Keys are written by our own importer, but a malformed one must not become a URL that
  // climbs out of the media prefix.
  assertObjectKey(objectKey);
  return `${MEDIA_BASE_URL}/${objectKey}`;
}

/** Public image shape used by the catalog and cart responses. */
export interface ImageView {
  readonly url: string;
  readonly alt: string;
  readonly width: number | null;
  readonly height: number | null;
}

export function toImageView(image: {
  objectKey: string;
  altText: string;
  widthPx: number | null;
  heightPx: number | null;
}): ImageView {
  return {
    url: mediaUrl(image.objectKey),
    alt: image.altText,
    width: image.widthPx,
    height: image.heightPx,
  };
}

/**
 * Serves MEDIA_ROOT at `/media` for the filesystem storage driver (development only —
 * env.ts refuses that driver in production, where a bucket or CDN serves the files).
 *
 * `Cross-Origin-Resource-Policy: cross-origin` overrides Helmet's `same-origin` default for
 * these files only: the storefront runs on another origin and must be able to load them.
 * Dotfiles and directory indexes are refused; a missing file falls through to the API's
 * JSON 404.
 */
export function filesystemMediaHandler(): RequestHandler {
  return express.static(path.resolve(env.MEDIA_ROOT), {
    index: false,
    dotfiles: 'deny',
    redirect: false,
    maxAge: '1d',
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });
}
