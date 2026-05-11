import { ImageResponse } from "next/og";
import { SITE } from "@/lib/site";

// Shared 1200x630 social share card used by both /opengraph-image and
// /twitter-image. Kept server-only and renderable by next/og (satori), so it
// only uses flexbox + inline styles + raw divs, no custom fonts, no grid.

export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;
export const SHARE_CARD_ALT = `${SITE.name} - ${SITE.tagline}`;
export const SHARE_CARD_CONTENT_TYPE = "image/png";

export function renderShareCard() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "88px",
          position: "relative",
          color: SITE.themeColor,
          fontFamily:
            '"Fraunces", "Cormorant Garamond", "Times New Roman", serif',
          background:
            "linear-gradient(135deg, #e8dfd0 0%, #d4c9b6 55%, #c6b89f 100%)",
        }}
      >
        {/* Warm rainy-cafe spotlight wash */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 22% 36%, rgba(184,135,82,0.28), transparent 55%), radial-gradient(circle at 78% 88%, rgba(192,140,131,0.22), transparent 60%)",
          }}
        />

        {/* Vinyl disc peeking in from the right edge. Pushed mostly off-canvas
            so the bottom-left text block reads clean with no overlap. */}
        <div
          style={{
            position: "absolute",
            top: -180,
            right: -440,
            width: 760,
            height: 760,
            borderRadius: "50%",
            background:
              "radial-gradient(circle at 50% 42%, #3a2e22 0%, #21170f 58%, #120d09 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 40px 120px rgba(33, 23, 15, 0.45)",
          }}
        >
          <div
            style={{
              width: 440,
              height: 440,
              borderRadius: "50%",
              // Satori (next/og) does not support conic-gradient, and it
              // refuses bare color strings inside a comma-separated
              // `background:` shorthand, so the pinwheel label is faked with
              // four pastel radial blobs at the cardinal corners (set via
              // backgroundImage) over a warm tan backgroundColor base. Same
              // palette as the favicon (#d2734a / #b88752 / #92a48a / #c08c83).
              backgroundColor: "#b88752",
              backgroundImage: [
                "radial-gradient(circle at 22% 28%, rgba(210,115,74,0.95) 0%, rgba(210,115,74,0) 58%)",
                "radial-gradient(circle at 78% 22%, rgba(184,135,82,0.95) 0%, rgba(184,135,82,0) 58%)",
                "radial-gradient(circle at 78% 78%, rgba(146,164,138,0.95) 0%, rgba(146,164,138,0) 58%)",
                "radial-gradient(circle at 22% 78%, rgba(192,140,131,0.95) 0%, rgba(192,140,131,0) 58%)",
              ].join(", "),
              border: "22px solid #2a1f15",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 170,
                height: 170,
                borderRadius: "50%",
                background: "#21170f",
                border: "2px solid rgba(240, 231, 214, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#0e0a07",
                }}
              />
            </div>
          </div>
        </div>

        {/* Content block, pushed to the bottom-left. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            marginTop: "auto",
            maxWidth: 720,
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontSize: 26,
              letterSpacing: "0.42em",
              textTransform: "uppercase",
              color: "#5a4b3a",
              marginBottom: 26,
              fontFamily: '"Inter", system-ui, sans-serif',
            }}
          >
            <span
              style={{
                width: 48,
                height: 2,
                background: "#b88752",
                display: "block",
              }}
            />
            rycord
          </div>
          <div
            style={{
              fontSize: 94,
              fontStyle: "italic",
              fontWeight: 600,
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
              marginBottom: 28,
              color: "#2d251c",
            }}
          >
            {SITE.tagline}
          </div>
          <div
            style={{
              fontSize: 30,
              lineHeight: 1.35,
              color: "#5a4b3a",
              maxWidth: 680,
              fontFamily: '"Inter", system-ui, sans-serif',
            }}
          >
            {SITE.shortDescription}
          </div>
        </div>

        {/* Bottom-right URL stamp */}
        <div
          style={{
            position: "absolute",
            right: 88,
            bottom: 60,
            fontSize: 22,
            letterSpacing: "0.26em",
            textTransform: "uppercase",
            color: "#5a4b3a",
            fontFamily: '"Inter", system-ui, sans-serif',
          }}
        >
          {SITE.url.replace(/^https?:\/\//, "")}
        </div>
      </div>
    ),
    { ...SHARE_CARD_SIZE },
  );
}
