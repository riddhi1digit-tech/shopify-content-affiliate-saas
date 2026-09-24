declare module "*.css";

// App Bridge supplies this custom element at runtime. The current Polaris type
// package does not yet declare it even though Shopify's template uses it.
declare namespace React.JSX {
  interface IntrinsicElements {
    "s-app-nav": React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement>,
      HTMLElement
    >;
  }
}
