"""Validate the referral guide's semantic tree, reading order, and five links.

This is a structural regression check, not a PDF/UA conformance validator or a
substitute for assistive-technology testing.
"""
import argparse
import json
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ArrayObject, ContentStream, DictionaryObject, IndirectObject, NumberObject


EXPECTED_LINKS = {
    "https://www.uclahealth.org/providers/jeremy-swisher": "physician & locations",
    "https://www.uclahealth.org/discover/healthcare-professionals": "referral instructions",
    "https://www.uclahealth.org/patient-resources/billing-insurance/health-insurance-accepted": "insurance",
    "https://jeremyswishermd.com/locations/#referrals": "jeremyswishermd.com/locations/#referrals",
    "https://jeremyswishermd.com/home-exercise-programs/": "jeremyswishermd.com/home-exercise-programs/",
}
EXPECTED_HEADINGS = [
    ("/H1", "Jeremy Swisher, MD"),
    ("/H2", "When to refer"),
    ("/H2", "Helpful information to send through UCLA's approved channels"),
    ("/H2", "Two UCLA clinic locations"),
    ("/H2", "Patient handoff"),
]


def identity(value):
    ref = value if isinstance(value, IndirectObject) else value.indirect_reference
    return ref.idnum, ref.generation


def validate(path):
    reader = PdfReader(path)
    assert reader.pdf_header == "%PDF-1.7"
    assert len(reader.pages) == 1, "Guide must stay one page"
    page = reader.pages[0]
    catalog = reader.trailer["/Root"]
    assert catalog["/Lang"] == "en-US"
    assert bool(catalog["/MarkInfo"]["/Marked"])
    assert page["/Tabs"] == "/S", "Tab order must follow structure"
    root = catalog["/StructTreeRoot"]
    assert root["/Type"] == "/StructTreeRoot"
    nums = root["/ParentTree"]["/Nums"]
    assert list(map(int, nums[::2])) == list(range(6)), "Page and five annotation parent keys required"
    parents = {int(nums[i]): nums[i+1].get_object() for i in range(0, len(nums), 2)}
    assert page["/StructParents"] == 0
    assert root["/ParentTreeNextKey"] == 6
    mcid_parents = parents[0]
    assert isinstance(mcid_parents, ArrayObject)

    # Read actual content streams independently of the generator's bookkeeping.
    # Every visible text operator must belong to one and only one MCID.
    stack, text_by_mcid, actual_text_by_mcid = [], {}, {}
    paint_ops = {b"S", b"s", b"f", b"F", b"f*", b"B", b"B*", b"b", b"b*", b"Do"}
    for operands, operator in ContentStream(page.get_contents(), reader).operations:
        if operator == b"BDC":
            tag, properties = operands
            assert "/MCID" in properties, "Unexpected marked content without MCID"
            mcid = int(properties["/MCID"])
            assert not stack, "Semantic runs must not be nested"
            assert mcid not in text_by_mcid, "Duplicate MCID"
            text_by_mcid[mcid] = ""
            actual_text_by_mcid[mcid] = str(properties["/ActualText"])
            stack.append((str(tag), mcid))
        elif operator == b"BMC":
            assert operands[0] == "/Artifact", "Only decoration may lack MCID"
            stack.append(("/Artifact", None))
        elif operator == b"EMC":
            assert stack, "Unmatched EMC"
            stack.pop()
        elif operator in {b"Tj", b"TJ", b"'", b'"'}:
            values = operands[-1] if operator == b"TJ" else [operands[-1]]
            text = "".join(str(value) for value in values if isinstance(value, str))
            if text:
                assert len(stack) == 1 and stack[0][1] is not None, "Untagged visible text"
                text_by_mcid[stack[0][1]] += text
        elif operator in paint_ops:
            assert stack and stack[-1][0] == "/Artifact", "Decoration must be an artifact"
    assert not stack, "Unclosed marked content"
    assert set(text_by_mcid) == set(range(len(mcid_parents)))
    assert all(text_by_mcid.values()), "Empty semantic text run"
    for mcid, text in text_by_mcid.items():
        assert actual_text_by_mcid[mcid] in {text, text + "\n"}, "ActualText must preserve the displayed words"

    used_mcids, used_annotations, headings, ordered_blocks, links = set(), set(), [], [], []

    def walk(node_ref, parent_ref):
        node = node_ref.get_object()
        assert node["/Type"] == "/StructElem"
        assert identity(node.raw_get("/P")) == identity(parent_ref), "Wrong structural parent"
        role = str(node["/S"])
        assert role in {"/Document", "/H1", "/H2", "/P", "/Link"}
        if role != "/Document":
            assert identity(node.raw_get("/Pg")) == identity(page), "Wrong owning page"
        text_parts, object_refs = [], []
        kids = node["/K"]
        kids = kids if isinstance(kids, ArrayObject) else [kids]
        for kid in kids:
            item = kid.get_object()
            if isinstance(item, NumberObject):
                mcid = int(item)
                assert mcid not in used_mcids, "MCID has multiple structural owners"
                assert identity(mcid_parents[mcid]) == identity(node_ref), "Incorrect MCID parent mapping"
                used_mcids.add(mcid)
                text_parts.append(actual_text_by_mcid[mcid])
            elif isinstance(item, DictionaryObject) and item.get("/Type") == "/OBJR":
                assert role == "/Link", "Annotation must belong to a Link"
                annotation_ref = item.raw_get("/Obj")
                annotation = annotation_ref.get_object()
                assert identity(annotation_ref) not in used_annotations
                used_annotations.add(identity(annotation_ref))
                assert annotation["/Subtype"] == "/Link"
                assert identity(parents[int(annotation["/StructParent"])] ) == identity(node_ref)
                assert identity(item.raw_get("/Pg")) == identity(page)
                assert identity(annotation.raw_get("/P")) == identity(page)
                object_refs.append(annotation)
            else:
                text_parts.append(walk(kid, node_ref))
        text = "".join(text_parts)
        if role in {"/H1", "/H2"}:
            headings.append((role, text.strip()))
        if role == "/Link":
            assert object_refs and text, "Link needs text and object reference"
            assert node["/Alt"] == text.strip()
            for annotation in object_refs:
                assert annotation["/Contents"] == text.strip()
                url = str(annotation["/A"]["/URI"])
                assert EXPECTED_LINKS[url] == text.strip(), "Link text points to unexpected destination"
                links.append({"text": text.strip(), "url": url})
        if role in {"/P", "/H1", "/H2"}:
            ordered_blocks.append({"role": role[1:], "text": text.strip()})
        return text

    document_ref = root.raw_get("/K")
    assert document_ref.get_object()["/S"] == "/Document"
    walk(document_ref, root.indirect_reference)
    assert used_mcids == set(text_by_mcid), "Orphaned text runs"
    assert used_annotations == {identity(ref) for ref in page["/Annots"]}, "Untagged annotation"
    assert len(links) == 5 and {item["url"] for item in links} == set(EXPECTED_LINKS)
    assert headings == EXPECTED_HEADINGS, "Heading hierarchy or reading order changed"
    assert ordered_blocks[0]["text"].startswith("REFERRAL GUIDE")
    clinic_blocks = [item["text"] for item in ordered_blocks if "Suite" in item["text"]]
    assert len(clinic_blocks) == 2 and clinic_blocks[0].startswith("Westwood") and clinic_blocks[1].startswith("West Hills")
    assert all(block.count("\n") == 3 for block in clinic_blocks), "Clinic address line boundaries lost"
    assert ordered_blocks[-2]["text"].startswith("Independent professional website guide")
    assert ordered_blocks[-1]["text"].startswith("Contact and location information checked")
    text = page.extract_text()
    for value in ["310-319-1234", "310-301-5391", "Suite 170", "Suite 604"]:
        assert value in text
    result = {
        "pages": 1, "language": str(catalog["/Lang"]),
        "text_runs": len(text_by_mcid), "semantic_blocks": len(ordered_blocks),
        "headings": headings, "links": links, "reading_order": ordered_blocks,
        "limitations": "Structural checks only; no PDF/UA certification or screen-reader usability claim.",
    }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.pdf), indent=2))
