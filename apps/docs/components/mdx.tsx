import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { McpAnchorRedirect } from './mcp-anchor-redirect';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    McpAnchorRedirect,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
