---
title: Document Centre
module: documents
summary: Every document you may open, found, previewed and downloaded in one place.
icon: doc
---

The Document Centre is one place to find a document without first finding the record that holds it.
An agreement, an offer letter, a query letter, an invoice or a certificate is listed here, whichever
part of the hub made it. You see only the documents you could already open from their own screens.

## Library {#document-centre-library screen=documents/library}

The Library lists every document you may open, the newest first. Four figures sit above the list,
then the filters and the search.

![The Library: four figures, the filters and the list of documents](shot:document-centre-library)

| Figure | What It Counts |
|---|---|
| **All Documents** | Every document you may open |
| **Added This Month** | Documents added since the first of this month |
| **Expiring Soon** | Documents that end within 60 days, or have already ended |
| **Signed** | Documents that are signed, sent or filed. A signed document is never replaced |

Pressing a figure shows the documents behind its number.

### Find a document {#document-centre-find}

1. Open [Document Centre · Library](/documents?tab=library).
2. Type in **Search documents**, above the list. Type any words you remember: part of its name, its
   type, or the partner or person it belongs to.
3. Read the list. It now holds only the documents that match every word you typed.
4. Press the document you want.

> **Tip:** To find a partner's service agreement, type the partner's name and the word agreement.
> You do not need to open the partner first.

When nothing matches, the list reads **No Documents Found**. Shorten what you typed, or clear a
filter.

### Filter the list {#document-centre-filter}

1. Open [Document Centre · Library](/documents?tab=library).
2. On a computer, use the four filters above the list. On a phone, press **Filter Documents**.
   ![The filters on a phone](shot:document-centre-filters)
3. Pick an **Area** to see one part of the hub, such as Partnerships or Expenses.
4. Pick a **Type** to see one kind of document, such as an agreement or an invoice.
5. Pick a **Status** to see only documents that are expiring or signed.
6. Pick when it was **Added**.
7. On a phone, press **Show Documents**.

To see everything again, press the **All Documents** figure. On a phone you can also press
**Clear Filters** in the filter sheet.

### Open, preview and download a document {#document-centre-open}

1. Press a document in the list. On a computer it opens beside the list. On a phone it opens in a
   sheet.
   ![A document open beside the list](shot:document-centre-document)
2. Read its details: its **Type**, what it **Belongs To**, when it was **Added** and when it
   **Expires**.
3. Press **View File** to read it full screen. This shows for PDFs, pictures and videos.
4. Press **Download** to save a copy on your device.
5. Press **Open Record** to go to the partner, the person or the request it belongs to. This shows
   only when you may open that screen.

> **Important:** A Word or Excel file has no preview. Press **Download** and open it on your device.

### Find a document from anywhere {#document-centre-search}

1. Press Ctrl and K on a computer, or the search icon at the top of a phone.
2. Type the document's name, its number, or the name of the partner or person it belongs to.
3. Press the document under **Documents**. The Library opens on it.

### If you cannot find a document {#document-centre-missing}

The Library lists a document only for the people who may open it. If a colleague can see a document
and you cannot, you do not hold the access its own screen needs. Ask Operations and People, or the
System Administrator.

If you open a link to a document that is not yours, the screen reads **Document Not Found**. Press
**Back to Library**.

Payslips are not listed here. Find yours on
[Employee Self-Service · My Payslips](/ess?tab=my-payslips).

```shot document-centre-library
open: /documents?tab=library
as: operations
marks:
  1: text "Expiring Soon" | Press a figure to see its documents
  2: searchbox | Find a document by any words
  3: row 1 | Press a document to open it
```

```shot document-centre-filters
open: /documents?tab=library
as: operations
device: phone
do:
  - click: button "Filter Documents"
  - wait: button "Show Documents"
crop: modal
marks:
  1: label "Area" | One part of the hub
  2: button "Show Documents" | Apply the filters
```

```shot document-centre-document
open: /documents?tab=library
as: operations
do:
  - click: text "Chowdeck Service Agreement"
  - wait: button "Download"
marks:
  1: button "Download" | Save a copy on this device
  2: button "Open Record" | Go to what it belongs to
```
