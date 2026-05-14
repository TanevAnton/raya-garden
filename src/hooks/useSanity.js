import { useEffect, useState } from "react";
import { sanityClient, SANITY_ENABLED } from "../lib/sanity.js";

// Fetch a GROQ query and return { data, loading, error }.
// While Sanity is not configured, returns { data: null, loading: false }
// so pages can gracefully fall back to static data.
export function useSanityQuery(query, params = {}) {
  const [state, setState] = useState({
    data: null,
    loading: SANITY_ENABLED,
    error: null,
  });

  // Stable JSON key for params so the effect re-runs only when they change.
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!SANITY_ENABLED) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    sanityClient
      .fetch(query, params)
      .then((data) => {
        if (!cancelled) setState({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("[Sanity] query failed:", error);
          setState({ data: null, loading: false, error });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, paramsKey]);

  return state;
}
