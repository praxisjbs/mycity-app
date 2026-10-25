---
title: Praxis AI
module: praxis_ai
summary: Ask questions about MyCity's work in plain words, and find your past questions.
icon: spark
---

Praxis AI answers questions about MyCity's work in plain words: "Who came in late this week?",
"What happened today?", "How many leave days do I have left?". It reads only the records your own
screens show you, so two colleagues asking the same question can get different answers. Nobody
else can read your questions, People and the CEO included.

Praxis AI never changes anything. Ask it to do something, such as add a task or request leave, and
it offers the screen where you do it, already filled in with what you said. Nothing is saved until
you press that screen's own button.

## Ask {#praxis-ask screen=praxis_ai/ask icon=spark}

Ask is a conversation: your questions on the right, Praxis AI's answers below them.

![Praxis AI, Ask](shot:praxis-ask)

### Ask a question {#praxis-ask-question needs="praxis_ai create"}

1. Open [Praxis AI · Ask](/praxis-ai?tab=ask).
2. A new conversation shows **Try Asking** with a few questions you can ask. Press one to ask it.
3. Or type your own question in **Ask a Question** at the foot of the screen, up to 500
   characters, and press **Send**.
4. While Praxis AI reads your records, it says **Reading Your Records**. The answer appears under
   your question.
5. Ask a follow-up in the same box. Praxis AI remembers the conversation, so "and last week?" is
   enough.

> **Tip:** On a computer, **Recent** beside the conversation lists your conversations, newest first.
> Press one to open it again.

### Read an answer {#praxis-ask-answer}

![An answer](shot:praxis-answer)

- The answer starts with a few sentences.
- A list of records shows as a table on a computer and as cards on a phone. When there are more
  than 25, it says how many, for example *Showing 25 of 312*. Press **Show Next 25** for the next
  ones.
- A button under the answer, such as *Open Attendance*, opens the screen where you would act on it.
- **From** lists the records the answer was read from. Press one to open it. When there are more
  than six, press the *+12 More* button to see the rest.
- Press **Helpful** or **Not Helpful** to say how good the answer was. Press it again to take it
  back.

> **Important:** An answer is a first reading of your records, not a decision. Check the figures
> on their screen before you act on them.

### Ask with your voice {#praxis-ask-voice needs="praxis_ai create"}

1. Press the microphone beside **Ask a Question**. Allow the microphone when your browser asks.
2. Speak your question. The time counts up while it records, for up to two minutes.
3. Press **Stop Recording**. Your words appear in the box.
4. Check them, correct anything it heard wrong, and press **Send**.

If the microphone is blocked, a message says **Microphone not allowed**: allow it in your
browser's settings for the hub. If nothing could be heard, it says **Could not transcribe**: type
the question instead.

### Have it do something for you {#praxis-ask-change needs="praxis_ai create"}

1. Ask for what you want, for example "add a task to send the weekly report by Friday" or "book a
   team meeting tomorrow at 10".
2. Praxis AI answers with a button for the screen where you do it, such as *Open Tasks* or
   *Open Calendar*.
3. Press it. The form opens filled in with what you said.
4. Check every field, change what is wrong, and press the form's own button to save.

Praxis AI can fill in a new task, a new event, a new project, a leave request and, for those who
may add people, a new employee.

### Start a new conversation {#praxis-ask-new needs="praxis_ai create"}

1. Press **New Conversation** at the top of the screen. It shows once a conversation is open.
2. Ask your question. A new conversation starts with it, titled by your first question.

A new conversation is best for a new subject: Praxis AI reads the last few questions of the
conversation you are in, and an old subject can confuse a new question.

### When an answer does not come {#praxis-ask-problems}

| The screen says | What it means | What to do |
|---|---|---|
| A red line with **Try Again** | The answer did not arrive, often a weak connection | Press **Try Again**. It does not ask twice |
| "I could not find that in the records you can read" | Nothing you may see answers the question | Ask about something on your own screens, or ask differently |
| **That conversation was deleted** | It was deleted in another tab or on another device | Ask again: a new conversation starts |

### Ask from any screen on a phone {#praxis-ask-anywhere}

![Praxis AI over a screen, on a phone](shot:praxis-panel)

1. On a phone, press the round button with a plus at the bottom right, **Quick Actions**.
2. Press **Praxis AI**. The conversation opens over the screen you are on.
3. Ask as on [Praxis AI · Ask](/praxis-ai?tab=ask). Pressing an answer's button or a record goes
   there and closes Praxis AI.
4. Your phone's Back gesture closes it and leaves your screen as it was. Press **Praxis AI** again
   to come back to the same conversation.

## History {#praxis-history screen=praxis_ai/history icon=history}

History lists your own conversations. Nobody else sees them.

![Praxis AI, History](shot:praxis-history)

### Read your history {#praxis-history-read}

1. Open [Praxis AI · History](/praxis-ai?tab=history).
2. The tiles count this month's **Questions**, **Conversations** and **Records Read** (how many
   records your answers were read from).
3. **Conversations** lists them, 25 to a page: **Title** (your first question), **Last Asked**,
   **Questions** and, on a computer, **Records Read**.
4. Type in **Search Conversations** to find one by its title.
5. Press a conversation to open it again on [Praxis AI · Ask](/praxis-ai?tab=ask) and carry on.

On a computer, **Questions by Module** shows which parts of the hub your questions were about.

### Delete a conversation, or all of them {#praxis-history-delete}

1. To delete one, press the three dots at the end of its row, **Conversation Actions**, then
   **Delete Conversation**. Confirm with **Delete Conversation**.
2. To delete every conversation, press **Clear History** at the top right. On a phone it is in the
   menu at the top right, **History Actions**. Confirm with **Clear History**.

Deleting removes the questions and answers for good. It does not change what AI Control's
[Spend](#ai-control-spend) counted for them.

```shot praxis-ask
open: /praxis-ai?tab=ask
as: staff
do:
  - wait: text "Try Asking"
marks:
  1: text "Try Asking" | Questions you can ask
  2: label "Ask a Question" | Type your question
  3: button "Record Question" | Ask with your voice
  4: button "Send" | Send it
```

```shot praxis-answer
open: /praxis-ai?tab=ask
as: operations
do:
  - fill: label "Ask a Question" = Who works with us?
  - click: button "Send"
  - wait: button "Helpful"
marks:
  1: button "Show Next 25" | The next 25 records
  2: text "From" | The records it read
  3: button "Helpful" | Say how good it was
  4: button "New Conversation" | Start again
```

```shot praxis-panel
open: /home?tab=overview
as: staff
device: phone
do:
  - click: button "Quick Actions"
  - click: button "Praxis AI"
  - wait: text "Try Asking"
marks:
  1: text "Try Asking" | Questions you can ask
  2: label "Ask a Question" | Type your question
```

```shot praxis-history
open: /praxis-ai?tab=history
as: operations
marks:
  1: text "Questions" | This month's questions
  2: searchbox | Find a conversation
```
