/**
 * card-template.ts
 *
 * Helper to render card art and metadata as an inline SVG string. The
 * `createCardSVG` function is used by the `TLCard` component and returns an
 * SVG markup string suitable for insertion into the DOM.
 */

/**
 * Create an inline SVG representation of a card.
 *
 * The SVG is returned as an HTML string and includes the art image (with a
 * fallback), name, cost, rarity gem, type icon and a compact description and
 * stats area. The `compact` option hides descriptive text to produce a
 * smaller card variant used in tight layouts.
 *
 * @param opts - card rendering options
 * @param opts.name - display name
 * @param opts.cost - play cost (number or string)
 * @param opts.rarity - rarity tier (controls gem color)
 * @param opts.description - multi-line description text (line breaks respected)
 * @param opts.stats - short stats string (displayed below description)
 * @param opts.image - url for the art image; if empty a placeholder is used
 * @param opts.type - card type used to select icon and colors
 * @param opts.compact - optional flag to omit descriptive text and reduce height
 * @returns SVG markup string
 */
export function createCardSVG(opts: {
    name: string;
    cost: number | string;
    rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
    description: string;
    stats: string;
    image: string;
    type: "attack" | "defense" | "buff" | "economy";
    compact?: boolean;
}): string {
    const typeColors = {
        attack: {banner: "#3A1B1B", frame: "#D34B4B"},
        defense: {banner: "#1B2D3A", frame: "#4A8ED3"},
        buff: {banner: "#2F1B3A", frame: "#B05AD3"},
        economy: {banner: "#3A321B", frame: "#D3A84A"},
    } as const;

    const rarityColorMap = {
        common: "#A0A0A0",
        uncommon: "#4CAF50",
        rare: "#3F51B5",
        epic: "#9C27B0",
        legendary: "#FFC107",
    } as const;

    const rarityRank = {
        common: 0,
        uncommon: 1,
        rare: 2,
        epic: 3,
        legendary: 4,
    } as const;

    const t = typeColors[opts.type] ?? typeColors.attack;
    const rarityColor = rarityColorMap[opts.rarity] ?? rarityColorMap.common;
    const rank = rarityRank[opts.rarity] ?? 0;
    const isRarePlus = rank >= 2;
    const frameStroke = isRarePlus ? rarityColor : t.frame;
    const iconPath = (() => {
        switch (opts.type) {
            case "attack":
                return `
          <path d="M12 20 L20 12 L22 14 L14 22 Z" fill="#F5F5F5"/>
          <rect x="10" y="22" width="6" height="3" rx="1" fill="#C69B6D"/>
        `;
            case "defense":
                return `
          <path d="M16 8 L24 11 L22 20 L16 25 L10 20 L8 11 Z"
                fill="#93C2D8"/>
        `;
            case "buff":
                return `
          <polygon points="16,9 18,14 23,14 19,17 20.5,22 16,19 11.5,22 13,17 9,14 14,14"
                   fill="#E8B3FF"/>
        `;
            case "economy":
            default:
                return `
          <circle cx="16" cy="16" r="8" fill="#F2D46A"/>
          <circle cx="16" cy="16" r="5" fill="#FFE8A4"/>
        `;
        }
    })();

    const imgHref = opts.image && opts.image.trim()
        ? opts.image
        : "/assets/placeholder.png";

    function wrapTextWithNewlines(
        text: string,
        maxChars = 42,
        maxLines = 3
    ): string[] {
        const paragraphs = (text || "").split(/\n+/);
        const lines: string[] = [];
        let truncated = false;

        outer: for (const p of paragraphs) {
            const normalized = p.replace(/\s+/g, " ").trim();
            if (!normalized) {
                continue;
            }

            const words = normalized.split(" ");
            let current = "";

            for (const w of words) {
                const test = current ? current + " " + w : w;
                if (test.length <= maxChars) {
                    current = test;
                } else {
                    if (current) {
                        lines.push(current);
                    } else {
                        // single very long word
                        lines.push(w.slice(0, maxChars));
                    }
                    current = "";
                    if (lines.length === maxLines) {
                        truncated = true;
                        break outer;
                    }
                }
            }

            if (current) {
                lines.push(current);
                if (lines.length === maxLines) {
                    // we used up all visual lines
                    truncated = paragraphs.length > 1 || words.length > 0;
                    break;
                }
            }
        }

        // If we filled all lines and still had more text, mark truncated
        if (lines.length === maxLines && !truncated) {
            const originalFlat = paragraphs.join(" ").replace(/\s+/g, " ").trim();
            const usedFlat = lines.join(" ").replace(/\s+/g, " ").trim();
            truncated = usedFlat.length < originalFlat.length;
        }

        // Apply ellipsis to last non-empty line if truncated
        if (truncated && lines.length > 0) {
            const lastIdx = lines.length - 1;
            const last = lines[lastIdx].replace(/\s+$/g, "");
            lines[lastIdx] = last.replace(/\.{3,}$/g, "") + "…";
        }

        // Pad out to maxLines with non-breaking spaces so we ALWAYS have maxLines
        while (lines.length < maxLines) {
            lines.push("\u00A0");
        }

        return lines;
    }

    const MAX_DESC_LINES = 4;
    const descriptionLines = wrapTextWithNewlines(
        opts.description,
        42,
        MAX_DESC_LINES
    );

    const LINE_HEIGHT = 16;
    const PADDING = 10;
    const descY = 260;
    const descHeight = (MAX_DESC_LINES - 1) * LINE_HEIGHT;
    const showText = !opts.compact;
    const showTypeText = !opts.compact;
    const artY = 70;
    const artHeight = showText ? 160 : 110;
    const innerFrameHeight = showText ? 396 : Math.max(artY + artHeight + 36, 180);
    const innerFrameWidth = 276;
    const innerFrameX = 12;
    const innerFrameY = 12;
    const svgHeight = showText ? 420 : Math.max(innerFrameY + innerFrameHeight + 8, 220);
    const compactDescY = artY + artHeight + 20;
    const descYUsed = showText ? descY : compactDescY;
    const dividerYUsed = descYUsed + descHeight + PADDING;
    const statsYUsed = dividerYUsed + 20;
    const iconY = showText ? 350 : (artY + artHeight + 20);
    const typeLabelY = showText ? 395 : (iconY + 40);

    return `
<svg class="card-svg"
     xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 300 ${svgHeight}">

  <defs>
    <!-- Shiny background gradient -->
    <linearGradient id="card-bg-gradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#303354"/>
      <stop offset="40%"  stop-color="#1b1c2a"/>
      <stop offset="100%" stop-color="#111219"/>
    </linearGradient>

    <!-- Top inner sheen -->
    <radialGradient id="card-bg-sheen" cx="50%" cy="0%" r="80%">
      <stop offset="0%"  stop-color="rgba(255,255,255,0.4)"/>
      <stop offset="60%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>

    <!-- Rarity halo -->
    <radialGradient id="rarity-halo-grad" cx="50%" cy="50%" r="70%">
      <stop offset="0%"   stop-color="${rarityColor}" stop-opacity="0.9"/>
      <stop offset="60%"  stop-color="${rarityColor}" stop-opacity="0.0"/>
      <stop offset="100%" stop-color="${rarityColor}" stop-opacity="0.0"/>
    </radialGradient>

    <!-- Art clipping rect -->
    <clipPath id="art-clip">
      <rect x="24" y="${artY}" width="252" height="${artHeight}" rx="15" />
    </clipPath>
  </defs>

  <!-- Shiny card base -->
  <rect x="0" y="0" width="300" height="${svgHeight}" rx="22"
        fill="url(#card-bg-gradient)"/>
  <rect x="0" y="0" width="300" height="${svgHeight}" rx="22"
        fill="url(#card-bg-sheen)"/>

  <!-- Main card content -->
  <g>
    <!-- Inner frame -->
    <rect x="${innerFrameX}" y="${innerFrameY}"
          width="${innerFrameWidth}" height="${innerFrameHeight}"
          rx="18"
          fill="${t.banner}"
          stroke="${frameStroke}"
          stroke-width="3"/>

    <!-- Optional inner rarity border for rare+ -->
    ${
        isRarePlus
            ? `
    <rect x="${innerFrameX + 6}" y="${innerFrameY + 6}" width="${innerFrameWidth - 12}" height="${innerFrameHeight - 12}" rx="14"
          fill="none"
          stroke="${rarityColor}"
          stroke-width="2"
          opacity="0.8" />
    `
            : ""
    }

    <!-- Cost -->
    <g transform="translate(22,22)">
      <rect x="0" y="0" width="48" height="34" rx="10"
            fill="#F6D46A" stroke="#FFF" stroke-width="2"/>
      <text x="24" y="23"
            text-anchor="middle"
            font-family="system-ui"
            font-size="18"
            fill="#000">
        ${opts.cost}
      </text>
    </g>

    <!-- Name banner -->
    <g transform="translate(78,22)">
      <rect x="0" y="0" width="160" height="30" rx="10"
            fill="${t.banner}"/>
      <text x="80" y="23"
            text-anchor="middle"
            font-family="system-ui"
            font-weight="600"
            font-size="16"
            fill="#F5F5F5">
        ${opts.name}
      </text>
    </g>

    <!-- Rarity gem -->
    <g transform="translate(247,22)">
      <polygon points="15,0 30,15 15,30 0,15"
               fill="${rarityColor}"
               stroke="#FFFFFF"
               stroke-width="2"/>
      <polygon points="15,5 25,15 15,25 5,15"
               fill="rgba(255,255,255,0.25)"/>
    </g>

    <!-- Art frame -->
    <rect x="24" y="${artY}" width="252" height="${artHeight}" rx="15"
          fill="#242633" stroke="${t.frame}" stroke-width="2"/>

    <!-- Pixel art -->
    <foreignObject x="24" y="${artY}" width="252" height="${artHeight}" clip-path="url(#art-clip)">
      <img
        xmlns="http://www.w3.org/1999/xhtml"
        src="${imgHref}"
        style="width:100%; height:100%; object-fit:cover; image-rendering:pixelated;"
        onerror="this.onerror=null; this.src='/assets/placeholder.png';"
       alt=""/>
    </foreignObject>

    <!-- Description (3 visual lines, \n respected) -->
    ${showText ? `
    <text x="150" y="${descYUsed}"
          text-anchor="middle"
          font-family="system-ui"
          font-size="15"
          fill="#EAEAEA">
      ${descriptionLines
        .map(
            (line, i) =>
                `<tspan x="150" dy="${i === 0 ? 0 : LINE_HEIGHT}">${line}</tspan>`
        )
        .join("")}
    </text>

    <!-- Divider -->
    <line x1="40" y1="${dividerYUsed}" x2="260" y2="${dividerYUsed}"
          stroke="${t.frame}" stroke-width="1"/>

    <!-- Stats -->
    <text x="150" y="${statsYUsed}"
          text-anchor="middle"
          font-family="system-ui"
          font-size="14"
          fill="#C4C7FF">
      ${opts.stats}
    </text>
    ` : ""}

    <!-- Type icon badge (bottom center) -->
    <g transform="translate(134, ${iconY})">
      <circle cx="16" cy="16" r="16" fill="${t.banner}" />
      ${iconPath}
    </g>

    <!-- Type label -->
    ${showTypeText ? `
    <text x="150" y="${typeLabelY}"
          text-anchor="middle"
          font-family="system-ui"
          font-size="12"
          fill="#C4C7FF">
      ${opts.type.charAt(0).toUpperCase() + opts.type.slice(1)}
    </text>
    ` : ""}
  </g>
</svg>
`;
}
