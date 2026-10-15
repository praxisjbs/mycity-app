import axe from "axe-core";

/**
 * Accessibility checks in component tests: `expect(await axe(container)).toHaveNoViolations()`.
 *
 * Two rules are off here because jsdom cannot judge them, not because they do not
 * matter: colour contrast (jsdom has no layout or computed colours; gate 14 checks
 * every token pair instead) and `region` (a component tested alone sits outside
 * any landmark by design).
 */
export async function axeCheck(container: Element, rules: Record<string, { enabled: boolean }> = {}): Promise<axe.AxeResults> {
  return axe.run(container, {
    rules: { "color-contrast": { enabled: false }, region: { enabled: false }, ...rules },
  });
}

export { axeCheck as axe };

function describe(v: axe.Result): string {
  const nodes = v.nodes.map((n) => `    ${n.target.join(" ")}\n      ${n.failureSummary?.split("\n").join("\n      ") ?? ""}`).join("\n");
  return `  ${v.id} (${v.impact ?? "n/a"}): ${v.help}\n${nodes}`;
}

export const axeMatchers = {
  toHaveNoViolations(results: axe.AxeResults) {
    const pass = results.violations.length === 0;
    return {
      pass,
      message: () =>
        pass ? "expected accessibility violations, found none" : `expected no accessibility violations, found ${results.violations.length}:\n${results.violations.map(describe).join("\n")}`,
    };
  },
};

declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): unknown;
  }
}
