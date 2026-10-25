---
title: AI Control
module: ai_control
summary: Which AI model answers each feature, the models' prices, and what AI costs each month.
icon: shield
---

AI Control decides which AI model answers each AI feature in the hub (Praxis AI, voice notes,
tidying a policy, drafting an email), what happens when that model cannot answer, and what AI
costs each month. IT and the System Administrator set it up. Operations and People can open it to
watch the spend, so the providers' accounts are topped up before they run out.

The providers' keys are kept on [Settings · Integrations](/settings?tab=integrations). AI Control
chooses among the models those keys can use.

## Actions {#ai-control-actions screen=ai_control/actions icon=spark}

Every AI feature is an **action**, and every action belongs to a **job**: the kind of work it is.
Each job has a **chain**: the model asked first, then up to three fallbacks, asked in turn when the
one before cannot answer.

![AI Control, Actions](shot:ai-control-actions)

### Read the jobs and their chains {#ai-control-actions-read}

1. Open [AI Control · Actions](/ai-control?tab=actions).
2. Each of the seven jobs is a card on a computer: **Default**, **Fast**, **Deep Reasoning**,
   **Image Reading**, **Transcription**, **Embeddings** and **Top Tier**. Point at a job's name to
   read what it is for. On a phone the jobs are a list: press one to see its chain.
3. A chain lists **First**, then **Fallback 1** to **Fallback 3**, each with its model, its
   provider and a pill saying whether it can answer now.
4. Below the jobs, **Actions** lists every AI feature with its job and **First Choice**, and on a
   computer **Calls Today**. Type in **Search actions** to find one.
5. Press an action to see the chain it uses.

| The pill says | What it means |
|---|---|
| **Ready** | The model answers when its turn comes |
| **Not Set Up** | Its provider has no key on Settings · Integrations |
| **Not on Key** | The provider's key can no longer use this model |
| **Daily Limit** | A free plan's limit for today is used up |
| **Skipped** | The provider said its limit is used up; it is asked again after the time shown |
| **At Cap** | The provider reached its monthly cap on [Spend](#ai-control-spend) |
| **Personal Data** | The model is DeepSeek and the action sends something about a person, so it is never asked |
| **Cannot Search** | The action needs a web search and this model cannot do one |

Beside an action, **Personal Data** means what it sends can name or describe a person; **Own
Chain** means it has a chain of its own instead of its job's; **Not Built Yet** means the feature
is not in the hub yet.

### Change a chain {#ai-control-actions-edit needs="ai_control edit"}

![Edit Chain](shot:ai-control-edit-chain)

1. On a job's card, press **Edit Chain**. On a phone, press the job, then **Edit Chain** in its
   sheet.
   ![A job's chain, on a phone](shot:ai-control-chain-phone)
2. Under **First Choice**, search for the model to ask first and pick it. Only models that can do
   the job are offered.
3. Pick up to three fallbacks under **Fallback 1**, **Fallback 2** and **Fallback 3**. They are
   optional.
4. Press **Save Chain**. A message says **Chain saved**.

**Embeddings** takes one model and no fallback. Once the Knowledge Hub has indexed anything, its
card says **Locked** and its model cannot be changed from here: ask the developers.

### Put a model first {#ai-control-actions-first needs="ai_control edit"}

1. Find the chain: a job's card, or press an action.
2. Press **Make First** beside the fallback you want asked first. A message says
   **Moved to first**.

### Give one action its own chain {#ai-control-actions-own needs="ai_control edit"}

1. Press the action in **Actions**.
2. Press **Edit Chain**, pick its models and press **Save Chain**. The action now shows
   **Own Chain**, and its job's chain is unchanged.
3. To put it back on its job's chain, press the action, then **Use Job Chain**. A message says
   **Back on its job's chain**.

## Models {#ai-control-models screen=ai_control/models icon=grid}

Models lists every model the providers' keys can use, with its price in dollars and in naira.

![AI Control, Models](shot:ai-control-models)

### Read the models {#ai-control-models-read}

1. Open [AI Control · Models](/ai-control?tab=models). The models in a chain come first.
2. Each row shows the **Model** with its provider and what it does, **On Key** (**Available**,
   **Not on Key** or **Not Checked**) and its **Price**. On a computer, **In Naira** and
   **In Chains** too.
3. Narrow the list with **Provider**, or with **Show**: **On Key** (the default), **Not on Key** or
   **Any**. Type in **Search models** to find one.
4. Press a model to see its **Provider**, **Model ID**, what it **Does**, **Plan**, **Price**,
   **In Naira**, **Per 1,000 Searches** and **In Chains**.
5. {needs="integrations view"} Press **Open Connection** in that sheet to open the provider's
   connection on Settings · Integrations.

### Find the models' prices {#ai-control-models-find needs="ai_control edit"}

AI reads each provider's pricing page and proposes a price for every model that has none. Nothing
is saved until you accept it. Each search is billed by the provider.

![New Prices](shot:ai-control-new-prices)

1. Press **Find Prices** at the top right. On a phone it is at the foot of the list. A message
   says **Finding prices**, and **New Prices** opens.
2. While it searches, a bar shows its progress, such as *Batch 2 of 4*. Prices appear as they
   arrive, each with the model, the price and the page it came from.
3. Press **Accept** to save a price, or **Dismiss** to drop it.
4. Press **Accept All** to save every price waiting. A message says how many were saved.
5. **Still to Price** counts the models with no price yet, and **Not Listed** the models the
   provider's page does not price. Press **Find More** to search for the rest.

While prices wait, the button reads **Review Prices**: press it to open **New Prices** again.

If a search stops, a pill says why:

| The pill says | What to do |
|---|---|
| **No Search Model** | Put a Gemini model in the **Deep Reasoning** chain: only it can search |
| **AI Switched Off** or **Monthly Cap Reached** | AI is off, or the cap on all AI is reached on [Spend](#ai-control-spend) |
| **Search Not Answering**, **Answer Not Readable**, **Search Failed** or **Search Stopped** | Press **Find Prices** again later |

### Set a price by hand {#ai-control-models-price needs="ai_control edit"}

1. Press the model, then **Edit Price**.
2. Fill in the dollar prices the provider publishes, each optional: **Input per Million**,
   **Output per Million**, **Audio per Million**, **Per Audio Hour** and **Per 1,000 Searches**.
3. Press **Save Prices**. A message says **Prices saved**.

## Spend {#ai-control-spend screen=ai_control/spend icon=wallet}

Spend shows what AI has cost this month, in naira, against each cap.

![AI Control, Spend](shot:ai-control-spend)

### Read the spend {#ai-control-spend-read}

1. Open [AI Control · Spend](/ai-control?tab=spend).
2. **All AI** shows the month's spend against the cap on all AI, with **Month Of**, **One Dollar**
   (the day's rate) and **Rates Of** (the day the rate is from).
3. Each provider shows **Free** or **Paid**, what it spent, its cap or *no cap*, and this month's
   calls. **Not Set Up** means it has no key; **At Cap** means it reached its cap.
4. On a computer, **Spend by Day** shows a bar for each day.
5. **By Action** lists each AI feature with its job, its calls and what it spent.

Nobody is notified when a cap is near or reached. Check Spend to know when to top up a provider's
account.

### Set a cap {#ai-control-spend-cap needs="ai_control edit"}

1. Press **Set Cap** on **All AI**, or on a paid provider's card.
2. Type the **Monthly Cap** in naira. Leave it empty to remove the cap.
3. Press **Set Cap**. A message says **Cap set**, or **Cap removed**.

| Cap | When it is reached |
|---|---|
| A provider's | That provider is skipped until the month ends, and the next model in each chain answers |
| **All AI** | No AI feature answers until the month ends |

```shot ai-control-actions
open: /ai-control?tab=actions
as: admin
marks:
  1: text "Default" | A job and its chain
  2: heading "Actions" | Every AI feature
```

```shot ai-control-edit-chain
open: /ai-control?tab=actions
as: admin
device: desktop
do:
  - click: button "Edit Chain"
  - wait: label "First Choice"
crop: modal
marks:
  1: label "First Choice" | The model asked first
  2: label "Fallback 1" | Asked next
```

```shot ai-control-chain-phone
open: /ai-control?tab=actions
as: admin
device: phone
do:
  - click: text "Default"
  - wait: button "Edit Chain"
crop: modal
marks:
  1: button "Edit Chain" | Change the chain
```

```shot ai-control-models
open: /ai-control?tab=models
as: admin
marks:
  1: searchbox | Find a model
  2: row 1 | Press a model for its prices
```

```shot ai-control-new-prices
open: /ai-control?tab=models
as: admin
do:
  - click: button "Review Prices"
  - wait: button "Accept All"
crop: modal
marks:
  1: button "Accept All" | Save every price
```

```shot ai-control-spend
open: /ai-control?tab=spend
as: admin
marks:
  1: text "All AI" | All AI against its cap
  2: button "Set Cap" | Set the cap
```
