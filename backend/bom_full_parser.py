import pdfplumber
import re


def normalize(text):
    if not text:
        return ""
    return re.sub(r"\s+", " ", text.strip().upper())


def find_header_index(headers, keywords):
    """
    Find column index by keyword matching
    """
    for i, h in enumerate(headers):
        for k in keywords:
            if k in h:
                return i
    return None


def parse_full_bom(pdf_path: str):
    """
    Robust full BOM parser.
    Extracts remaining details keyed by FIND NUMBER.
    """

    bom = {}

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()

            for table in tables:
                if not table or len(table) < 2:
                    continue

                headers = [normalize(h) for h in table[0]]

                # Identify columns dynamically
                col_map = {
                    "FIND NUMBER": find_header_index(headers, ["FIND"]),
                    "REFERENCE DESIGNATOR": find_header_index(headers, ["REFERENCE"]),
                    "CATALOGUE NUMBER": find_header_index(headers, ["CATALOGUE"]),
                    "PART DESCRIPTION": find_header_index(headers, ["PART DESCRIPTION"]),
                    "QTY": find_header_index(headers, ["QTY"]),
                    "UNIT OF MEASURE": find_header_index(headers, ["UNIT"]),
                    "MAKE": find_header_index(headers, ["MAKE"]),
                    "INHOUSE/BOUGHT-OUT/COTS": find_header_index(headers, ["INHOUSE", "COTS", "BOUGHT"]),
                    "LOCAL/IMPORT": find_header_index(headers, ["LOCAL", "IMPORT"]),
                }

                # FIND NUMBER & PART DESCRIPTION are mandatory
                if col_map["FIND NUMBER"] is None or col_map["PART DESCRIPTION"] is None:
                    continue

                for row in table[1:]:
                    if not row:
                        continue

                    try:
                        find_no = row[col_map["FIND NUMBER"]]
                    except Exception:
                        continue

                    if not find_no:
                        continue

                    find_no = str(find_no).strip()

                    bom[find_no] = {
                        "FIND NUMBER": find_no,
                        "REFERENCE DESIGNATOR": normalize(row[col_map["REFERENCE DESIGNATOR"]]) if col_map["REFERENCE DESIGNATOR"] is not None else "",
                        "CATALOGUE NUMBER": normalize(row[col_map["CATALOGUE NUMBER"]]) if col_map["CATALOGUE NUMBER"] is not None else "",
                        "QTY": normalize(row[col_map["QTY"]]) if col_map["QTY"] is not None else "",
                        "UNIT OF MEASURE": normalize(row[col_map["UNIT OF MEASURE"]]) if col_map["UNIT OF MEASURE"] is not None else "",
                        "MAKE": normalize(row[col_map["MAKE"]]) if col_map["MAKE"] is not None else "",
                        "INHOUSE/BOUGHT-OUT/COTS": normalize(row[col_map["INHOUSE/BOUGHT-OUT/COTS"]]) if col_map["INHOUSE/BOUGHT-OUT/COTS"] is not None else "",
                        "LOCAL/IMPORT": normalize(row[col_map["LOCAL/IMPORT"]]) if col_map["LOCAL/IMPORT"] is not None else "",
                    }

    return bom
