from app.scoring.matching_engine import (
    SCORE_WEIGHTS,
    compute_final_score,
    decide_recommendation,
    run_matching_engine,
    score_experience_match,
    score_location_match,
    score_skill_match,
)


class TestScoreExperienceMatch:
    def test_below_minimum_returns_zero(self):
        assert score_experience_match(2, 5, 10) == 0

    def test_exactly_minimum_boundary_returns_one(self):
        assert score_experience_match(5, 5, 10) == 1

    def test_within_range_returns_one(self):
        assert score_experience_match(7, 5, 10) == 1

    def test_exactly_maximum_boundary_returns_one(self):
        assert score_experience_match(10, 5, 10) == 1

    def test_above_maximum_returns_point_eight(self):
        assert score_experience_match(11, 5, 10) == 0.8

    def test_null_max_is_unbounded(self):
        assert score_experience_match(50, 5, None) == 1

    def test_one_year_below_minimum_boundary(self):
        assert score_experience_match(4, 5, 10) == 0


class TestScoreSkillMatch:
    def test_computes_overlap_over_required(self):
        assert score_skill_match(["react", "node.js"], ["react", "node.js", "aws", "docker"]) == 0.5

    def test_case_insensitive_and_trims_whitespace(self):
        assert score_skill_match([" React ", "NODE.JS"], ["react", "node.js"]) == 1

    def test_no_overlap_returns_zero(self):
        assert score_skill_match(["cobol"], ["react", "node.js"]) == 0

    def test_no_required_skills_is_full_match(self):
        assert score_skill_match(["anything"], []) == 1

    def test_superset_returns_one(self):
        assert score_skill_match(["react", "node.js", "aws"], ["react", "node.js"]) == 1


class TestScoreLocationMatch:
    def test_remote_opening_returns_one(self):
        assert score_location_match("Gotham City", "Remote") == 1

    def test_no_location_specified_treated_as_remote(self):
        assert score_location_match("Gotham City", None) == 1

    def test_exact_case_insensitive_match_returns_one(self):
        assert score_location_match("gotham city", "Gotham City") == 1

    def test_onsite_mismatch_returns_half(self):
        assert score_location_match("Metropolis", "Gotham City") == 0.5

    def test_unknown_candidate_location_onsite_opening_returns_half(self):
        assert score_location_match(None, "Gotham City") == 0.5


class TestComputeFinalScore:
    def test_uses_mandated_weights(self):
        assert SCORE_WEIGHTS == {"skill": 0.5, "experience": 0.3, "location": 0.2}
        assert compute_final_score(1, 1, 1) == 1
        assert compute_final_score(0, 0, 0) == 0

    def test_worked_example(self):
        # 0.5*0.8 + 0.3*1 + 0.2*1 = 0.4 + 0.3 + 0.2 = 0.9
        assert compute_final_score(0.8, 1, 1) == 0.9

    def test_deterministic_across_repeated_calls(self):
        a = compute_final_score(0.6, 0.8, 0.5)
        b = compute_final_score(0.6, 0.8, 0.5)
        assert a == b


class TestRunMatchingEngine:
    def test_produces_exact_shape_mandated_by_spec(self):
        result = run_matching_engine(
            candidate_experience_years=6,
            candidate_skills=["react", "node.js"],
            candidate_location="Remote",
            experience_min=3,
            experience_max=8,
            required_skills=["react", "node.js", "aws"],
            opening_location="Remote",
        )

        assert result.skillMatchScore == 2 / 3
        assert result.experienceMatchScore == 1
        assert result.locationMatchScore == 1
        assert result.finalScore == compute_final_score(2 / 3, 1, 1)


class TestDecideRecommendation:
    def test_recommended_at_and_above_threshold(self):
        assert decide_recommendation(0.75) == "RECOMMENDED"
        assert decide_recommendation(0.9) == "RECOMMENDED"

    def test_borderline_range(self):
        assert decide_recommendation(0.5) == "BORDERLINE"
        assert decide_recommendation(0.74) == "BORDERLINE"

    def test_not_recommended_below_threshold(self):
        assert decide_recommendation(0.49) == "NOT_RECOMMENDED"
        assert decide_recommendation(0) == "NOT_RECOMMENDED"
