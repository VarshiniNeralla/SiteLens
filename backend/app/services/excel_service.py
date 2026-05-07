from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from app.domain import ObservationRecord


def _d(v: object) -> str:
    if hasattr(v, "isoformat") and callable(getattr(v, "isoformat")):
        iso = getattr(v, "isoformat")()
        return iso if iso else "—"
    s = str(v).strip() if v is not None else ""
    return s if s else "—"


def build_quality_observation_xlsx(
    *,
    observations: list[ObservationRecord],
    output_path: Path,
) -> Path:
    wb = Workbook()
    ws = wb.active
    ws.title = "Observations"

    headers = [
        "Project name",
        "Tower",
        "Floor",
        "Flat / Unit",
        "Room",
        "Observation type",
        "Severity",
        "Site visit date",
        "Slab casting date",
        "Inspection status",
        "3rd-party status",
        "Observation number",
        "Generated observation text",
        "Recommendation text",
        "Image reference",
    ]

    ws.append(headers)
    for i, obs in enumerate(observations, start=1):
        ws.append(
            [
                obs.project_name,
                obs.tower,
                obs.floor,
                obs.flat,
                obs.room,
                obs.observation_type,
                obs.severity,
                _d(obs.site_visit_date),
                _d(obs.slab_casting_date),
                obs.inspection_status,
                obs.third_party_status,
                i,
                obs.generated_observation,
                obs.generated_recommendation,
                Path(obs.image_path).name,
            ]
        )

    header_fill = PatternFill(fill_type="solid", fgColor="F2F2F2")
    thin_side = Side(border_style="thin", color="000000")
    border = Border(left=thin_side, right=thin_side, top=thin_side, bottom=thin_side)

    for col_idx, _ in enumerate(headers, start=1):
        h = ws.cell(row=1, column=col_idx)
        h.font = Font(name="Calibri", size=11, bold=True)
        h.fill = header_fill
        h.border = border
        h.alignment = Alignment(vertical="center", horizontal="left", wrap_text=True)

    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, min_col=1, max_col=len(headers)):
        for cell in row:
            cell.font = Font(name="Calibri", size=10)
            cell.border = border
            cell.alignment = Alignment(vertical="top", horizontal="left", wrap_text=True)

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    for col_idx in range(1, len(headers) + 1):
        max_len = max(len(str(ws.cell(row=r, column=col_idx).value or "")) for r in range(1, ws.max_row + 1))
        width = min(max(12, max_len + 2), 56)
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    output_path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(output_path))
    return output_path
