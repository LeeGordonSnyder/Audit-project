# Excel workbooks

Standalone Excel tools from before the app, each in its own folder. They don't
talk to the app or the shared Google Sheet.

| Folder | What it is |
| --- | --- |
| [`sku-inventory-audit/`](sku-inventory-audit/) | SKU audit workbook: UPC lookup from a pasted Product Master, audit history, Mark In / Mark Out discrepancy queues with sign-off, and an Overdue-to-Scan list. The VBA macro is in `SKUAudit_Automation_Macro.txt`. |
| [`daily-sales-report/`](daily-sales-report/) | Daily sales report workbook: paste the day's sales export, get a dashboard with a date selector and a weekly report. |

The app's Counts module and the Deployment tab's Hourly Tracker now cover most
of what these did.
