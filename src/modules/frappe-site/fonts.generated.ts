// Written by scripts/frappe-editor/fonts.mjs; do not edit.
/** The fonts that ship with the site editor (open fonts, latin subset), by the files in public/frappe-editor/fonts. */
export interface FontFace {
  /** A weight, or a range of weights for a variable font ("200 700"). */
  weight: string;
  style: "normal" | "italic";
  /** Under public/frappe-editor/fonts. */
  file: string;
}
export interface FontFamily {
  family: string;
  group: string;
  faces: FontFace[];
  /** The variants the editor's font picker lists ("regular", "700", "italic" ...). */
  variants: string[];
}
export const FONT_CATALOG: FontFamily[] = [
  {
    "family": "Anton",
    "group": "Destaque",
    "faces": [
      {
        "weight": "400",
        "style": "normal",
        "file": "anton/anton-latin-400-normal.woff2"
      }
    ],
    "variants": [
      "regular"
    ]
  },
  {
    "family": "Barlow Condensed",
    "group": "Destaque",
    "faces": [
      {
        "weight": "400",
        "style": "normal",
        "file": "barlow-condensed/barlow-condensed-latin-400-normal.woff2"
      },
      {
        "weight": "500",
        "style": "normal",
        "file": "barlow-condensed/barlow-condensed-latin-500-normal.woff2"
      },
      {
        "weight": "600",
        "style": "normal",
        "file": "barlow-condensed/barlow-condensed-latin-600-normal.woff2"
      },
      {
        "weight": "700",
        "style": "normal",
        "file": "barlow-condensed/barlow-condensed-latin-700-normal.woff2"
      },
      {
        "weight": "800",
        "style": "normal",
        "file": "barlow-condensed/barlow-condensed-latin-800-normal.woff2"
      }
    ],
    "variants": [
      "regular",
      "500",
      "600",
      "700",
      "800"
    ]
  },
  {
    "family": "Bebas Neue",
    "group": "Destaque",
    "faces": [
      {
        "weight": "400",
        "style": "normal",
        "file": "bebas-neue/bebas-neue-latin-400-normal.woff2"
      }
    ],
    "variants": [
      "regular"
    ]
  },
  {
    "family": "DM Sans",
    "group": "Texto",
    "faces": [
      {
        "weight": "100 1000",
        "style": "normal",
        "file": "dm-sans/dm-sans-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "100",
      "200",
      "300",
      "regular",
      "500",
      "600",
      "700",
      "800",
      "900",
      "1000"
    ]
  },
  {
    "family": "Inter",
    "group": "Texto",
    "faces": [
      {
        "weight": "100 900",
        "style": "normal",
        "file": "Inter/Inter.var.woff2"
      },
      {
        "weight": "100 900",
        "style": "italic",
        "file": "Inter/Inter-Italic.var.woff2"
      }
    ],
    "variants": [
      "100",
      "200",
      "300",
      "regular",
      "500",
      "600",
      "700",
      "800",
      "900",
      "italic",
      "700italic"
    ]
  },
  {
    "family": "JetBrains Mono",
    "group": "Monoespaçada",
    "faces": [
      {
        "weight": "100 800",
        "style": "normal",
        "file": "jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "100",
      "200",
      "300",
      "regular",
      "500",
      "600",
      "700",
      "800"
    ]
  },
  {
    "family": "Lora",
    "group": "Serifada",
    "faces": [
      {
        "weight": "400 700",
        "style": "normal",
        "file": "lora/lora-latin-wght-normal.woff2"
      },
      {
        "weight": "400 700",
        "style": "italic",
        "file": "lora/lora-latin-wght-italic.woff2"
      }
    ],
    "variants": [
      "regular",
      "500",
      "600",
      "700",
      "italic",
      "500italic",
      "600italic",
      "700italic"
    ]
  },
  {
    "family": "Manrope",
    "group": "Texto",
    "faces": [
      {
        "weight": "200 800",
        "style": "normal",
        "file": "manrope/manrope-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "200",
      "300",
      "regular",
      "500",
      "600",
      "700",
      "800"
    ]
  },
  {
    "family": "Merriweather",
    "group": "Serifada",
    "faces": [
      {
        "weight": "400",
        "style": "normal",
        "file": "merriweather/merriweather-latin-400-normal.woff2"
      },
      {
        "weight": "700",
        "style": "normal",
        "file": "merriweather/merriweather-latin-700-normal.woff2"
      }
    ],
    "variants": [
      "regular",
      "700"
    ]
  },
  {
    "family": "Montserrat",
    "group": "Texto",
    "faces": [
      {
        "weight": "100 900",
        "style": "normal",
        "file": "montserrat/montserrat-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "100",
      "200",
      "300",
      "regular",
      "500",
      "600",
      "700",
      "800",
      "900"
    ]
  },
  {
    "family": "Open Sans",
    "group": "Texto",
    "faces": [
      {
        "weight": "300 800",
        "style": "normal",
        "file": "open-sans/open-sans-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "300",
      "regular",
      "500",
      "600",
      "700",
      "800"
    ]
  },
  {
    "family": "Oswald",
    "group": "Destaque",
    "faces": [
      {
        "weight": "200 700",
        "style": "normal",
        "file": "oswald/oswald-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "200",
      "300",
      "regular",
      "500",
      "600",
      "700"
    ]
  },
  {
    "family": "Playfair Display",
    "group": "Serifada",
    "faces": [
      {
        "weight": "400 900",
        "style": "normal",
        "file": "playfair-display/playfair-display-latin-wght-normal.woff2"
      },
      {
        "weight": "400 900",
        "style": "italic",
        "file": "playfair-display/playfair-display-latin-wght-italic.woff2"
      }
    ],
    "variants": [
      "regular",
      "500",
      "600",
      "700",
      "800",
      "900",
      "italic",
      "500italic",
      "600italic",
      "700italic",
      "800italic",
      "900italic"
    ]
  },
  {
    "family": "Poppins",
    "group": "Texto",
    "faces": [
      {
        "weight": "400",
        "style": "normal",
        "file": "poppins/poppins-latin-400-normal.woff2"
      },
      {
        "weight": "500",
        "style": "normal",
        "file": "poppins/poppins-latin-500-normal.woff2"
      },
      {
        "weight": "600",
        "style": "normal",
        "file": "poppins/poppins-latin-600-normal.woff2"
      },
      {
        "weight": "700",
        "style": "normal",
        "file": "poppins/poppins-latin-700-normal.woff2"
      }
    ],
    "variants": [
      "regular",
      "500",
      "600",
      "700"
    ]
  },
  {
    "family": "Roboto",
    "group": "Texto",
    "faces": [
      {
        "weight": "100 900",
        "style": "normal",
        "file": "roboto/roboto-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "100",
      "200",
      "300",
      "regular",
      "500",
      "600",
      "700",
      "800",
      "900"
    ]
  },
  {
    "family": "Space Grotesk",
    "group": "Texto",
    "faces": [
      {
        "weight": "300 700",
        "style": "normal",
        "file": "space-grotesk/space-grotesk-latin-wght-normal.woff2"
      }
    ],
    "variants": [
      "300",
      "regular",
      "500",
      "600",
      "700"
    ]
  }
];
