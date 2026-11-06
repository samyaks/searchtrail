import pytest

from culltool.query import CriteriaError, CullCriteria, build_kql, describe, quote_term, term_queries, validate

GUID_A = "44444444-4444-4444-8444-444444444444"
GUID_B = "66666666-6666-4666-8666-666666666666"


@pytest.mark.parametrize("term, expected", [
    ("fraud", "fraud"),
    ("invoic*", "invoic*"),
    ("project falcon", '"project falcon"'),
    ('"project falcon"', '"project falcon"'),
    ("e-mail", '"e-mail"'),
    ("o'brien", '"o\'brien"'),
    ("NOT", '"NOT"'),
])
def test_quote_term(term, expected):
    assert quote_term(term) == expected


@pytest.mark.parametrize("term", ["", "  ", "*voice", "in*voice x", 'say "hi"', '"unbalanced', "big data*"])
def test_quote_term_rejects(term):
    with pytest.raises(CriteriaError):
        quote_term(term)


def test_full_query_scopes_each_filter_to_the_right_item_type():
    c = CullCriteria.from_dict({
        "keywords": ["project falcon", "invoic*"],
        "date_from": "2024-01-01",
        "date_to": "2024-12-31",
        "kinds": ["email", "docs"],
        "file_extensions": ["docx", "pdf"],
        "participant_domains": ["acme.com"],
        "exclude_keywords": ["weekly digest"],
    })
    assert build_kql(c) == (
        '("project falcon" OR invoic*) AND '
        "((kind:email AND ((sent>=2024-01-01 AND sent<=2024-12-31) OR (received>=2024-01-01 AND received<=2024-12-31)) "
        "AND participants:acme.com) OR "
        "(kind:docs AND (lastmodifiedtime>=2024-01-01 AND lastmodifiedtime<=2024-12-31) "
        "AND (fileextension:docx OR fileextension:pdf))) AND "
        'NOT "weekly digest"'
    )


def test_domain_filter_never_touches_documents():
    c = CullCriteria.from_dict({"kinds": ["docs", "email"], "participant_domains": ["acme.com"]})
    kql = build_kql(c)
    docs_clause = kql.split(" OR ")[0]
    assert docs_clause.startswith("(kind:docs") and "participants" not in docs_clause
    assert any("Documents are not filtered by domain" in w for w in validate(c, kql))


def test_labels_and_open_ended_dates():
    c = CullCriteria.from_dict({"kinds": ["docs"], "date_from": "2025-03-01",
                                "label_ids": [GUID_A.upper()], "exclude_label_ids": [GUID_B]})
    assert build_kql(c) == (
        f"InformationProtectionLabelId:{GUID_A} AND (kind:docs AND lastmodifiedtime>=2025-03-01) "
        f"AND NOT InformationProtectionLabelId:{GUID_B}"
    )


def test_all_mode_and_raw_kql():
    c = CullCriteria.from_dict({"keywords": ["alpha", "beta"], "keyword_mode": "ALL", "kinds": ["email"],
                                "raw_kql": "hasattachment:true"})
    assert build_kql(c) == "(alpha AND beta) AND kind:email AND (hasattachment:true)"


@pytest.mark.parametrize("bad", [
    {"kinds": []},
    {"kinds": ["fax"]},
    {"keyword_mode": "some"},
    {"date_from": "2024-13-01"},
    {"date_from": "2024/01/01"},
    {"date_from": "2025-01-01", "date_to": "2024-01-01"},
    {"file_extensions": ["docx"], "kinds": ["email"]},
    {"participant_domains": ["acme.com"], "kinds": ["docs"]},
    {"participant_domains": ["not a domain"]},
    {"label_ids": ["confidential"]},
    {"label_ids": [GUID_A], "exclude_label_ids": [GUID_A]},
    {"keywrods": ["typo"]},
    {"raw_kql": "   "},
])
def test_invalid_criteria_fail_before_any_api_call(bad):
    with pytest.raises(CriteriaError):
        CullCriteria.from_dict(bad)


def test_term_queries_keep_other_filters():
    c = CullCriteria.from_dict({"keywords": ["alpha", "beta gamma"], "kinds": ["email"], "date_from": "2024-01-01"})
    queries = term_queries(c)
    assert [t for t, _ in queries] == ["alpha", "beta gamma"]
    assert queries[1][1].startswith('"beta gamma" AND (kind:email AND')


def test_warnings():
    broad = CullCriteria.from_dict({})
    assert any("very broad" in w for w in validate(broad, build_kql(broad)))
    short = CullCriteria.from_dict({"keywords": ["ab*"]})
    assert any("short stem" in w for w in validate(short, build_kql(short)))
    long = CullCriteria.from_dict({"keywords": [f"term{i}" for i in range(50)]})
    assert any("characters" in w for w in validate(long, build_kql(long), max_chars=100))


def test_describe_is_plain_english():
    c = CullCriteria.from_dict({"keywords": ["invoic*"], "date_from": "2024-01-01", "date_to": "2024-06-30",
                                "kinds": ["email", "docs"], "participant_domains": ["acme.com"],
                                "label_ids": [GUID_A]})
    text = describe(c, label_name=lambda g: "Confidential/Finance")
    assert "Date range from 2024-01-01 to 2024-06-30" in text
    assert "documents by last modified date" in text
    assert "Documents are not filtered by domain" in text
    assert "Confidential/Finance" in text and "Items without a label are excluded" in text
