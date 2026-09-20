from app.scoring.skill_normalization import normalize_skill, normalize_skills


class TestNormalizeSkill:
    def test_maps_common_aliases_to_canonical_form(self):
        assert normalize_skill("JS") == "javascript"
        assert normalize_skill("ReactJS") == "react"
        assert normalize_skill("Node") == "node.js"
        assert normalize_skill("K8s") == "kubernetes"

    def test_lowercases_and_trims_unknown_skills_instead_of_dropping(self):
        assert normalize_skill("  GraphQL  ") == "graphql"
        assert normalize_skill("Some Obscure Tool") == "some obscure tool"


class TestNormalizeSkills:
    def test_deduplicates_after_normalization(self):
        assert normalize_skills(["JS", "javascript", "Javascript"]) == ["javascript"]

    def test_filters_empty_or_whitespace_entries(self):
        assert normalize_skills(["React", "", "   "]) == ["react"]
