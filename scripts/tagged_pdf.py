"""Small semantic-tagging adapter for this single-page ReportLab guide.

Requires reportlab and pypdf. The ReportLab _textOut/_linkRecord hooks are
deliberately guarded by validation; this is not a PDF/UA certification tool.
"""
from contextlib import contextmanager
from dataclasses import dataclass, field

from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfgen.textobject import PDFTextObject
from reportlab.pdfbase.pdfdoc import PDFString
from reportlab.platypus import Paragraph
from pypdf import PdfWriter
from pypdf.generic import (
    ArrayObject, BooleanObject, DictionaryObject, NameObject, NumberObject,
    TextStringObject,
)


@dataclass
class Element:
    role: str
    order: int
    runs: list = field(default_factory=list)
    links: dict = field(default_factory=dict)


class TaggedParagraph(Paragraph):
    def __init__(self, text, style, tagger, role="P"):
        super().__init__(text, style)
        self.semantic_element = tagger.element(role)

    def draw(self):
        with self.canv.semantic(self.semantic_element):
            super().draw()


class TaggedTextObject(PDFTextObject):
    """Tag each text-show run without changing its original painting operators."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._semantic_link = None
        self._semantic_last_run = None

    def _tagged_text(self, text, render, line_end=False):
        if not text:
            # Explicit <br/> may be emitted as an empty line-ending run.
            # Preserve its boundary on the preceding visible run.
            run = self._semantic_last_run
            if line_end and run is not None and not run["actual"].endswith("\n"):
                run["actual"] += "\n"
                self._code[run["code_index"]] = self._marker(run)
            return render()
        canvas = self._canvas
        element = canvas.active_element
        assert element is not None, "Every nonempty text run needs semantic context"
        run = {
            "mcid": len(canvas.tagger.runs),
            "text": str(text),
            "element": element,
            "link": self._semantic_link,
            "actual": str(text) + ("\n" if line_end else ""),
            "code_index": len(self._code),
        }
        element.runs.append(run)
        canvas.tagger.runs.append(run)
        self._semantic_last_run = run
        # ReportLab omits the whitespace at wrapped line endings. ActualText
        # supplies that boundary for structural readers, with no visual change.
        self._code.append(self._marker(run))
        render()
        self._code.append("EMC")

    def _marker(self, run):
        actual = PDFString(run["actual"]).format(self._canvas._doc).decode("latin1")
        return f'/Span <</MCID {run["mcid"]} /ActualText {actual}>> BDC'

    def _textOut(self, text, TStar=0):
        return self._tagged_text(
            text, lambda: super(TaggedTextObject, self)._textOut(text, TStar), bool(TStar)
        )

    def textLine(self, text=""):
        return self._tagged_text(
            text, lambda: super(TaggedTextObject, self).textLine(text), True
        )

    def _linkRecord(self, key, state):
        # ReportLab calls start immediately AFTER the first linked _textOut;
        # it calls end before the following unlinked text (or at line end).
        element = self._canvas.active_element
        if state == "start":
            assert self._semantic_link is None, "Nested links are unsupported"
            assert self._semantic_last_run is not None, "Link lacks text"
            link = element.links.setdefault(key, {"url": key[1], "annotations": []})
            self._semantic_link = link
            self._semantic_last_run["link"] = link
        elif state == "end":
            assert self._semantic_link is element.links[key], "Link callback mismatch"
            self._semantic_link = None
        else:
            raise AssertionError(f"Unknown link callback: {state}")


class TaggedCanvas(Canvas):
    def __init__(self, *args, tagger, **kwargs):
        kwargs["pdfVersion"] = (1, 7)
        super().__init__(*args, **kwargs)
        self.tagger = tagger
        self.active_element = None

    @contextmanager
    def semantic(self, element):
        previous = self.active_element
        self.active_element = element
        try:
            yield
        finally:
            self.active_element = previous

    def beginText(self, x=0, y=0, direction=None):
        return TaggedTextObject(self, x, y, direction=direction)

    def linkURL(self, url, rect, *args, **kwargs):
        assert self.active_element is not None, "Link lacks paragraph context"
        matches = [v for v in self.active_element.links.values() if v["url"] == url]
        assert len(matches) == 1, "Link annotation must match exactly one semantic link"
        matches[0]["annotations"].append(self._annotationCount)
        return super().linkURL(url, rect, *args, **kwargs)

    def rect(self, *args, **kwargs):
        self._code.append("/Artifact BMC")
        super().rect(*args, **kwargs)
        self._code.append("EMC")

    def line(self, *args, **kwargs):
        self._code.append("/Artifact BMC")
        super().line(*args, **kwargs)
        self._code.append("EMC")


def dictionary(**entries):
    return DictionaryObject({NameObject("/" + key): value for key, value in entries.items()})


class SemanticPDF:
    def __init__(self):
        self.elements = []
        self.runs = []

    def element(self, role="P", footer=False):
        element = Element(role, len(self.elements) + (10000 if footer else 0))
        self.elements.append(element)
        return element

    def paragraph(self, text, style, role="P"):
        return TaggedParagraph(text, style, self, role)

    def canvas(self, *args, **kwargs):
        return TaggedCanvas(*args, tagger=self, **kwargs)

    def footer_text(self, canvas, x, y, text):
        with canvas.semantic(self.element(footer=True)):
            canvas.drawString(x, y, text)

    def finish(self, path):
        """Attach standard structure/parent trees and annotation object references."""
        writer = PdfWriter(clone_from=str(path))
        writer.pdf_header = "%PDF-1.7"
        assert len(writer.pages) == 1, "Tagging is scoped to the one-page guide"
        page = writer.pages[0]
        page_ref = page.indirect_reference
        root = dictionary(Type=NameObject("/StructTreeRoot"))
        root_ref = writer._add_object(root)
        document = dictionary(Type=NameObject("/StructElem"), S=NameObject("/Document"), P=root_ref)
        document_ref = writer._add_object(document)
        root[NameObject("/K")] = document_ref
        children = ArrayObject()
        parent_array = ArrayObject([None] * len(self.runs))
        annotation_parents = {}

        for element in sorted(self.elements, key=lambda item: item.order):
            assert element.runs, "Empty semantic element"
            node = dictionary(Type=NameObject("/StructElem"), S=NameObject("/" + element.role),
                              P=document_ref, Pg=page_ref)
            node_ref = writer._add_object(node)
            children.append(node_ref)
            kids = ArrayObject()
            link_nodes = {}
            for run in element.runs:
                mcid = NumberObject(run["mcid"])
                link = run["link"]
                if link is None:
                    kids.append(mcid)
                    parent_array[mcid] = node_ref
                    continue
                identity = id(link)
                if identity not in link_nodes:
                    linked_runs = [r for r in element.runs if r["link"] is link]
                    label = "".join(r["text"] for r in linked_runs)
                    link_node = dictionary(Type=NameObject("/StructElem"), S=NameObject("/Link"),
                                           P=node_ref, Pg=page_ref, Alt=TextStringObject(label))
                    link_ref = writer._add_object(link_node)
                    link_kids = ArrayObject()
                    link_node[NameObject("/K")] = link_kids
                    link_nodes[identity] = (link_ref, link_kids)
                    kids.append(link_ref)
                    assert link["annotations"], "Linked text lacks clickable annotation"
                    for index in link["annotations"]:
                        annotation_ref = page["/Annots"][index]
                        annotation = annotation_ref.get_object()
                        assert annotation["/A"]["/URI"] == link["url"], "Annotation order changed"
                        parent_key = index + 1
                        annotation[NameObject("/StructParent")] = NumberObject(parent_key)
                        annotation[NameObject("/Contents")] = TextStringObject(label)
                        annotation[NameObject("/P")] = page_ref
                        annotation_parents[parent_key] = link_ref
                        link_kids.append(dictionary(Type=NameObject("/OBJR"), Obj=annotation_ref, Pg=page_ref))
                link_ref, link_kids = link_nodes[identity]
                # Text precedes the annotation object reference in the Link's children.
                link_kids.insert(len(link_kids) - len(link["annotations"]), mcid)
                parent_array[mcid] = link_ref
            node[NameObject("/K")] = kids

        assert all(item is not None for item in parent_array), "Unowned text MCID"
        assert len(annotation_parents) == len(page.get("/Annots", [])), "Untagged annotation"
        document[NameObject("/K")] = children
        nums = ArrayObject([NumberObject(0), writer._add_object(parent_array)])
        for key, value in sorted(annotation_parents.items()):
            nums.extend([NumberObject(key), value])
        root[NameObject("/ParentTree")] = writer._add_object(dictionary(Nums=nums))
        root[NameObject("/ParentTreeNextKey")] = NumberObject(len(annotation_parents) + 1)
        page[NameObject("/StructParents")] = NumberObject(0)
        page[NameObject("/Tabs")] = NameObject("/S")
        writer.root_object[NameObject("/StructTreeRoot")] = root_ref
        writer.root_object[NameObject("/MarkInfo")] = dictionary(Marked=BooleanObject(True))
        writer.root_object[NameObject("/Lang")] = TextStringObject("en-US")
        writer.root_object[NameObject("/ViewerPreferences")] = dictionary(DisplayDocTitle=BooleanObject(True))
        with open(path, "wb") as stream:
            writer.write(stream)
