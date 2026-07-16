import io
import unittest
import zipfile

from launch import parse_xlsx_rows


class XlsxImportTests(unittest.TestCase):
    def test_reads_first_sheet_with_inline_strings(self):
        workbook = """<?xml version="1.0" encoding="UTF-8"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets><sheet name="Films" sheetId="1" r:id="rId1"/></sheets>
        </workbook>""".encode("utf-8")
        relationships = """<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1"
            Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
            Target="worksheets/sheet1.xml"/>
        </Relationships>""".encode("utf-8")
        sheet = """<?xml version="1.0" encoding="UTF-8"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetData>
            <row r="1">
              <c r="A1" t="inlineStr"><is><t>Название</t></is></c>
              <c r="B1" t="inlineStr"><is><t>Год</t></is></c>
            </row>
            <row r="2">
              <c r="A2" t="inlineStr"><is><t>Начало</t></is></c>
              <c r="B2"><v>2010</v></c>
            </row>
          </sheetData>
        </worksheet>""".encode("utf-8")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("xl/workbook.xml", workbook)
            archive.writestr("xl/_rels/workbook.xml.rels", relationships)
            archive.writestr("xl/worksheets/sheet1.xml", sheet)

        rows = parse_xlsx_rows(buffer.getvalue())
        self.assertEqual(rows, [{"Название": "Начало", "Год": "2010"}])


if __name__ == "__main__":
    unittest.main()
