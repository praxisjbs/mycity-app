import { describe, it } from "vitest";
import { RuleTester, type Rule } from "eslint";
// @ts-expect-error eslint.shared.js is plain ESM JavaScript with no types; only its plugin is read here.
import { plugin } from "../../eslint.shared.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } } });
const rules = (plugin as { rules: Record<string, Rule.RuleModule> }).rules;

describe("mycity/no-void-press (F26)", () => {
  tester.run("no-void-press", rules["no-void-press"]!, {
    valid: [
      "<Button onClick={save}>Save Worksite</Button>",
      "<Button onClick={() => save()}>Save Worksite</Button>",
      "<Button onClick={async () => { await save(); close(); }}>Save Worksite</Button>",
      "<Button onClick={() => (close(), drop(row))}>Remove Device</Button>",
      // A function nested inside the handler is its own business.
      "<Button onClick={() => later(() => void ping())}>Send Note</Button>",
      // Only the components that watch the work, on the prop they watch.
      "<Chip onClick={() => void save()}>Late</Chip>",
      "<Button onFocus={() => void warm()}>Save Worksite</Button>",
      // An async handler hands back a promise of its own; a void inside it is a side job.
      "<Button onClick={async () => { await save(); void track(); }}>Save Worksite</Button>",
      "const save = async () => { await run(); void track(); }; <Button onClick={save}>Save Worksite</Button>;",
      "const save = () => run().then(close); <Button onClick={save}>Save Worksite</Button>;",
      "function save() { return run().then(close); } <Button onClick={() => save()}>Save Worksite</Button>;",
      // A name from elsewhere (a prop) cannot be read here.
      "<Button onClick={onSave}>Save Worksite</Button>",
    ],
    invalid: [
      { code: "<Button onClick={() => void save()}>Save Worksite</Button>", errors: 1 },
      { code: "<IconButton icon=\"refresh\" label=\"Refresh List\" onClick={() => void reload()} />", errors: 1 },
      { code: "<BigButton onClick={() => { if (!ok) return; void send(); }}>Clock In</BigButton>", errors: 1 },
      { code: "<Button onClick={() => (close(), void drop(row))}>Remove Device</Button>", errors: 1 },
      { code: "<Form onSubmit={() => void submit()}>{fields}</Form>", errors: 1 },
      { code: "<Wizard onFinish={function () { void submit(); }} steps={steps} finish=\"Publish Vacancy\" />", errors: 1 },
      { code: "<ConfirmDialog onConfirm={() => void revoke()} />", errors: 1 },
      { code: "<ExportButton onExport={() => void run()} />", errors: 1 },
      // The work dropped inside the local function the handler names or calls.
      { code: "const decline = () => void run(); <Button onClick={decline}>Decline Offer</Button>;", errors: 1 },
      { code: "const submit = () => { if (!ok) return; save().then(close); }; <Button onClick={() => submit()}>Save Worksite</Button>;", errors: 1 },
      { code: "function submit() { void save(); } <Form onSubmit={submit}>{fields}</Form>;", errors: 1 },
      { code: "const submit = useCallback(() => { void save(); }, []); <Button onClick={submit}>Save Worksite</Button>;", errors: 1 },
    ],
  });
});
