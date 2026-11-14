# SKU inventory audit workbook

`SKU_Inventory_Audit_Workbook.xlsx` (tabs: SKU Audit, Lists, Instructions,
VBA Code). Paste the Product Master export, scan or type a UPC, and the
workbook fills in the product and keeps the audit history. Discrepancies go to
Mark In / Mark Out queues for an adjuster to sign off, and styles not scanned
in 29 days show on the Overdue-to-Scan list.

The workbook needs its macro. The source is in `SKUAudit_Automation_Macro.txt`
(also on the workbook's VBA Code tab); the Instructions tab has the setup.
