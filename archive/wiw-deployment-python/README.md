# Audit-project

## WiW → Deployment Workbook automation

Automates filling out the morning deployment Excel workbook from a When I
Work schedule export: transfers each person's shift/role and auto-computes
evenly-spaced, coverage-safe break times. See
[`wiw_deployment/README.md`](wiw_deployment/README.md) for setup and usage.

```bash
pip install -r requirements.txt
python -m wiw_deployment demo-template --output demo_template.xlsx
python -m wiw_deployment build \
    --wiw wiw_deployment/samples/sample_wiw_export.csv \
    --template demo_template.xlsx --sheet Demo \
    --date 2026-08-30 --date-cell C1 --output filled_demo.xlsx
python -m pytest wiw_deployment/tests/ -v
```