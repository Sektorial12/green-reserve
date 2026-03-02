"use client";

import posthog from "posthog-js";

import { isE2eTest } from "@/lib/e2e";
import { env } from "@/lib/env";

type EventProperties = Record<string, unknown>;

let initialized = false;

export function initAnalytics() {
  if (initialized) return;
  if (typeof window === "undefined") return;
  if (isE2eTest()) return;

  const key = env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  posthog.init(key, {
    api_host: "https://app.posthog.com",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
  });

  initialized = true;
}

export function trackEvent(event: string, properties?: EventProperties) {
  if (typeof window === "undefined") return;
  if (isE2eTest()) return;

  const key = env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  if (!initialized) initAnalytics();
  posthog.capture(event, properties);
}

export function identifyUser(distinctId: string, properties?: EventProperties) {
  if (typeof window === "undefined") return;
  if (isE2eTest()) return;

  const key = env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  if (!initialized) initAnalytics();
  posthog.identify(distinctId, properties);
}
