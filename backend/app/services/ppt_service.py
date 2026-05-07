from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml import parse_xml
from pptx.oxml.ns import nsdecls
from pptx.util import Emu, Inches, Pt

from app.config import settings
from app.domain import ObservationRecord
from app.logging_config import get_logger

logger = get_logger(__name__)

# 16:9 widescreen with compact, engineering-style density.
SLIDE_W_IN = 13.333
SLIDE_H_IN = 7.5
OBS_PER_SLIDE = 3

# Layout constants (inches).
MARGIN_X = 0.35
TITLE_TOP = 0.16
TITLE_H = 0.32
SUBTITLE_TOP = 0.50
SUBTITLE_H = 0.26
CONTENT_TOP = 0.86
CONTENT_BOTTOM_MARGIN = 0.22
BLOCK_GAP = 0.20
INNER_GAP = 0.07
IMAGE_H = 2.15
TABLE_TOP_GAP = 0.08

TITLE_COLOR = RGBColor(155, 0, 0)
TEXT_COLOR = RGBColor(0, 0, 0)
HEADER_FILL = RGBColor(242, 242, 242)


@dataclass(frozen=True)
class Rect:
    left: float
    top: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.left + self.width

    @property
    def bottom(self) -> float:
        return self.top + self.height


def _chunks(items: list[ObservationRecord], size: int) -> Iterable[list[ObservationRecord]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _d(v: object) -> str:
    if hasattr(v, "isoformat") and callable(getattr(v, "isoformat")):
        iso = getattr(v, "isoformat")()
        return iso if iso else "—"
    s = str(v).strip() if v is not None else ""
    return s if s else "—"


def _observation_rows(obs: ObservationRecord, obs_no: int) -> list[tuple[str, str]]:
    location = ", ".join(
        x
        for x in [
            f"Tower {obs.tower}" if obs.tower else "",
            f"Floor {obs.floor}" if obs.floor else "",
            f"Flat {obs.flat}" if obs.flat else "",
            obs.room or "",
        ]
        if x
    )
    return [
        ("Location", location or "—"),
        ("Severity", _d(obs.severity)),
        ("Date of slab casting", _d(obs.slab_casting_date)),
        ("Date of site visit", _d(obs.site_visit_date)),
        ("Inspection by 3rd party", _d(obs.third_party_status)),
        ("Availability in 3rd party reports", _d(obs.inspection_status)),
        ("Observation no.", str(obs_no)),
    ]


def _fit_with_aspect_bottom_aligned(box: Rect, image_path: Path) -> Rect:
    with Image.open(image_path) as im:
        img_w, img_h = im.size

    if img_w <= 0 or img_h <= 0:
        return box

    box_ratio = box.width / box.height
    img_ratio = img_w / img_h
    if img_ratio > box_ratio:
        draw_w = box.width
        draw_h = draw_w / img_ratio
    else:
        draw_h = box.height
        draw_w = draw_h * img_ratio

    draw_left = box.left + (box.width - draw_w) / 2
    draw_top = box.top + (box.height - draw_h)  # bottom aligned for consistent baseline
    return Rect(draw_left, draw_top, draw_w, draw_h)


def _set_cell_border_thin_black(cell: object) -> None:
    tc = cell._tc  # type: ignore[attr-defined]
    tc_pr = tc.get_or_add_tcPr()
    for edge in ("a:lnL", "a:lnR", "a:lnT", "a:lnB"):
        line = parse_xml(
            f"<{edge} w='12700' cap='flat' cmpd='sng' algn='ctr' {nsdecls('a')}>"
            "<a:solidFill><a:srgbClr val='000000'/></a:solidFill>"
            "<a:prstDash val='solid'/></{edge}>".replace("{edge}", edge)
        )
        tc_pr.append(line)


def _add_header(slide: object, subtitle: str) -> None:
    title_box = slide.shapes.add_textbox(
        Inches(MARGIN_X),
        Inches(TITLE_TOP),
        Inches(SLIDE_W_IN - 2 * MARGIN_X),
        Inches(TITLE_H),
    )
    tf = title_box.text_frame
    tf.clear()
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = "Quality walkthrough - Observation"
    run.font.size = Pt(22)
    run.font.bold = True
    run.font.italic = True
    run.font.color.rgb = TITLE_COLOR
    p.alignment = PP_ALIGN.LEFT

    subtitle_box = slide.shapes.add_textbox(
        Inches(MARGIN_X),
        Inches(SUBTITLE_TOP),
        Inches(SLIDE_W_IN - 2 * MARGIN_X),
        Inches(SUBTITLE_H),
    )
    stf = subtitle_box.text_frame
    stf.clear()
    sp = stf.paragraphs[0]
    srun = sp.add_run()
    srun.text = subtitle
    srun.font.size = Pt(16)
    srun.font.italic = True
    srun.font.color.rgb = TITLE_COLOR
    sp.alignment = PP_ALIGN.LEFT


def _add_missing_image_placeholder(slide: object, image_box: Rect, image_path: Path) -> None:
    ph = slide.shapes.add_textbox(
        Inches(image_box.left),
        Inches(image_box.top),
        Inches(image_box.width),
        Inches(image_box.height),
    )
    tf = ph.text_frame
    tf.clear()
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = f"Image missing\n{image_path.name}"
    r.font.size = Pt(9)
    r.font.color.rgb = TEXT_COLOR
    p.alignment = PP_ALIGN.CENTER
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE


def _add_table(slide: object, table_box: Rect, obs: ObservationRecord, obs_no: int) -> None:
    rows = _observation_rows(obs, obs_no)
    table = slide.shapes.add_table(
        len(rows),
        2,
        Inches(table_box.left),
        Inches(table_box.top),
        Inches(table_box.width),
        Inches(table_box.height),
    ).table

    left_col_w = table_box.width * 0.52
    table.columns[0].width = Inches(left_col_w)
    table.columns[1].width = Inches(table_box.width - left_col_w)

    row_h_emu = Emu(Inches(table_box.height) // len(rows))
    for i, (label, value) in enumerate(rows):
        row = table.rows[i]
        row.height = row_h_emu
        c0 = row.cells[0]
        c1 = row.cells[1]

        c0.text = label
        c1.text = value
        c0.vertical_anchor = MSO_ANCHOR.MIDDLE
        c1.vertical_anchor = MSO_ANCHOR.MIDDLE

        p0 = c0.text_frame.paragraphs[0]
        p1 = c1.text_frame.paragraphs[0]
        p0.alignment = PP_ALIGN.LEFT
        p1.alignment = PP_ALIGN.LEFT
        for p in (p0, p1):
            if p.runs:
                p.runs[0].font.size = Pt(8.5)
                p.runs[0].font.bold = False
                p.runs[0].font.color.rgb = TEXT_COLOR

        c0.fill.solid()
        c0.fill.fore_color.rgb = HEADER_FILL

        _set_cell_border_thin_black(c0)
        _set_cell_border_thin_black(c1)


def _render_observation_block(
    slide: object,
    obs: ObservationRecord,
    obs_no: int,
    block: Rect,
    cwd: Path,
) -> None:
    image_box = Rect(block.left, block.top, block.width, IMAGE_H)
    table_top = image_box.bottom + TABLE_TOP_GAP
    table_box = Rect(block.left, table_top, block.width, block.bottom - table_top)

    img_path = Path(obs.image_path)
    if not img_path.is_absolute():
        img_path = cwd / img_path

    if img_path.is_file():
        fit = _fit_with_aspect_bottom_aligned(image_box, img_path)
        slide.shapes.add_picture(
            str(img_path.resolve()),
            Inches(fit.left),
            Inches(fit.top),
            width=Inches(fit.width),
            height=Inches(fit.height),
        )
    else:
        _add_missing_image_placeholder(slide, image_box, img_path)

    _add_table(slide, table_box, obs, obs_no)


def _blank_slide_layout(prs: Presentation):  # noqa: ANN001
    for lay in prs.slide_layouts:
        if "blank" in (lay.name or "").lower():
            return lay
    return prs.slide_layouts[-1]


def _resolve_subtitle(page_obs: list[ObservationRecord]) -> str:
    kinds = {o.observation_type.strip() for o in page_obs if o.observation_type and o.observation_type.strip()}
    if len(kinds) == 1:
        return kinds.pop()
    return "Mixed observations"


def build_quality_report_pptx(
    *,
    project_name: str,
    title: str,
    observations: list[ObservationRecord],
    output_path: Path,
) -> Path:
    _ = project_name  # Project consistency validated upstream; slide subtitle uses observation type.
    _ = title  # Header title is standardized per requested layout.

    template_path = settings.ppt_template_path
    if template_path is not None and Path(template_path).is_file():
        prs = Presentation(str(Path(template_path).resolve()))
        logger.info("PPT base presentation loaded from %s", template_path)
    else:
        prs = Presentation()

    prs.slide_width = Inches(SLIDE_W_IN)
    prs.slide_height = Inches(SLIDE_H_IN)
    blank = _blank_slide_layout(prs)
    cwd = Path.cwd()

    content_height = SLIDE_H_IN - CONTENT_TOP - CONTENT_BOTTOM_MARGIN
    block_width = (SLIDE_W_IN - 2 * MARGIN_X - 2 * BLOCK_GAP) / OBS_PER_SLIDE

    for group_idx, group in enumerate(_chunks(observations, OBS_PER_SLIDE), start=1):
        slide = prs.slides.add_slide(blank)
        _add_header(slide, _resolve_subtitle(group))

        for idx, obs in enumerate(group):
            left = MARGIN_X + idx * (block_width + BLOCK_GAP)
            block = Rect(left, CONTENT_TOP, block_width, content_height)
            _render_observation_block(
                slide,
                obs,
                obs_no=(group_idx - 1) * OBS_PER_SLIDE + idx + 1,
                block=block,
                cwd=cwd,
            )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))
    return output_path
