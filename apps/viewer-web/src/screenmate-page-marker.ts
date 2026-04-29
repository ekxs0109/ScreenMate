const SCREENMATE_APP_MARKER = "screenmate-app";

export function markScreenMateViewerPage(
  documentLike: Pick<
    Document,
    "createElement" | "documentElement" | "head" | "querySelector"
  > = document,
) {
  documentLike.documentElement.setAttribute("data-screenmate-app", "viewer");

  const existingMarker = documentLike.querySelector(
    `meta[name="${SCREENMATE_APP_MARKER}"]`,
  );
  if (existingMarker) {
    existingMarker.setAttribute("content", "viewer");
    return;
  }

  const marker = documentLike.createElement("meta");
  marker.setAttribute("name", SCREENMATE_APP_MARKER);
  marker.setAttribute("content", "viewer");
  documentLike.head.appendChild(marker);
}
