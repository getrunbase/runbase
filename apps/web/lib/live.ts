// `live` source of a CodeHost: the page's SSE /api/live (automatic
// EventSource reconnection; everything is reloaded on resume).
// `draft`: feed filtered by the draft permissions.
export function pageLive(pageId: string, draft = false) {
  return (fn: (objects: string[] | "*") => void) => {
    const es = new EventSource(
      `/api/live?page=${encodeURIComponent(pageId)}${draft ? "&draft=1" : ""}`,
    );
    let opened = false;
    es.onopen = () => {
      if (opened) fn("*");
      opened = true;
    };
    es.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { objects?: unknown };
        if (Array.isArray(m.objects)) fn(m.objects.map(String));
      } catch {
        // unreadable message ignored
      }
    };
    return () => es.close();
  };
}
