/**
 * MinaDental GE-0004 — Centralized Semantic Layered Surface Tokens
 *
 * Bridges three platform design languages on one semantic token layer while preserving
 * MinaDental's QBank curved tile geometry, Aurora backdrop, and WCAG 2.2 AA contrast:
 * - Apple Liquid Glass-inspired layered translucent surfaces with crisp specular edges
 * - Material 3 Adaptive tonal surface containers with clean elevation hierarchy
 * - Windows Fluent 2 subtle mica/acrylic translucent chrome with hairline borders
 */

export type SurfaceDesignLanguage = 'apple' | 'material' | 'fluent';
export type SurfaceThemeMode = 'light' | 'dark';

export interface SemanticSurfaceTokens {
  glassBg: string;
  glassElevated: string;
  glassBorder: string;
  specularHighlight: string;
  blurRadius: string;
  elevationShadow: string;
  headerBg: string;
  dockBg: string;
  cardRadius: string;
  controlRadius: string;
}

export const ADAPTIVE_CONTAINER_MAX_WIDTH = {
  mobile: '576px',
  tablet: '1024px',
  desktop: '1280px',
  ultrawide: '1560px',
} as const;

export const SURFACE_TOKENS: Record<
  SurfaceDesignLanguage,
  Record<SurfaceThemeMode, SemanticSurfaceTokens>
> = {
  apple: {
    light: {
      glassBg: 'rgba(255, 255, 255, 0.84)',
      glassElevated: 'rgba(255, 255, 255, 0.92)',
      glassBorder: 'rgba(203, 213, 225, 0.78)',
      specularHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.92)',
      blurRadius: '18px',
      elevationShadow: '0 8px 24px rgba(15, 23, 42, 0.065), 0 1px 2px rgba(15, 23, 42, 0.04)',
      headerBg: 'rgba(244, 247, 249, 0.82)',
      dockBg: 'rgba(255, 255, 255, 0.88)',
      cardRadius: '22px',
      controlRadius: '14px',
    },
    dark: {
      glassBg: 'rgba(17, 32, 46, 0.82)',
      glassElevated: 'rgba(22, 39, 56, 0.90)',
      glassBorder: 'rgba(71, 98, 125, 0.56)',
      specularHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.09)',
      blurRadius: '20px',
      elevationShadow: '0 12px 28px rgba(2, 6, 23, 0.48), 0 1px 2px rgba(2, 6, 23, 0.35)',
      headerBg: 'rgba(10, 20, 30, 0.84)',
      dockBg: 'rgba(17, 32, 46, 0.90)',
      cardRadius: '22px',
      controlRadius: '14px',
    },
  },
  material: {
    light: {
      glassBg: 'rgba(255, 255, 255, 0.97)',
      glassElevated: 'rgba(248, 250, 252, 0.98)',
      glassBorder: 'rgba(216, 226, 234, 0.95)',
      specularHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.6)',
      blurRadius: '8px',
      elevationShadow: '0 3px 12px rgba(20, 46, 67, 0.06), 0 1px 3px rgba(20, 46, 67, 0.04)',
      headerBg: 'rgba(244, 247, 249, 0.96)',
      dockBg: 'rgba(255, 255, 255, 0.97)',
      cardRadius: '20px',
      controlRadius: '16px',
    },
    dark: {
      glassBg: 'rgba(17, 32, 46, 0.96)',
      glassElevated: 'rgba(23, 41, 58, 0.98)',
      glassBorder: 'rgba(43, 66, 88, 0.92)',
      specularHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      blurRadius: '8px',
      elevationShadow: '0 6px 18px rgba(2, 6, 23, 0.44)',
      headerBg: 'rgba(10, 20, 30, 0.96)',
      dockBg: 'rgba(17, 32, 46, 0.97)',
      cardRadius: '20px',
      controlRadius: '16px',
    },
  },
  fluent: {
    light: {
      glassBg: 'rgba(255, 255, 255, 0.90)',
      glassElevated: 'rgba(252, 253, 254, 0.95)',
      glassBorder: 'rgba(148, 163, 184, 0.42)',
      specularHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.85)',
      blurRadius: '14px',
      elevationShadow: '0 2px 10px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(15, 23, 42, 0.03)',
      headerBg: 'rgba(244, 247, 249, 0.90)',
      dockBg: 'rgba(255, 255, 255, 0.93)',
      cardRadius: '14px',
      controlRadius: '10px',
    },
    dark: {
      glassBg: 'rgba(17, 32, 46, 0.88)',
      glassElevated: 'rgba(22, 40, 56, 0.94)',
      glassBorder: 'rgba(148, 163, 184, 0.22)',
      specularHighlight: 'inset 0 1px 0 rgba(255, 255, 255, 0.07)',
      blurRadius: '16px',
      elevationShadow: '0 6px 20px rgba(2, 6, 23, 0.48), 0 0 0 1px rgba(255, 255, 255, 0.04)',
      headerBg: 'rgba(10, 20, 30, 0.90)',
      dockBg: 'rgba(17, 32, 46, 0.93)',
      cardRadius: '14px',
      controlRadius: '10px',
    },
  },
};

export function resolveSurfaceTokens(
  design: SurfaceDesignLanguage,
  theme: SurfaceThemeMode
): SemanticSurfaceTokens {
  return SURFACE_TOKENS[design]?.[theme] ?? SURFACE_TOKENS.apple[theme];
}
