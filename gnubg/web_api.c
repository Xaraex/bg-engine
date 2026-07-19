/*
 * web_api.c
 *
 * Minimal JSON API surface for the WebAssembly build of GNU Backgammon.
 * Exposes position setup, move analysis, cube analysis and static
 * evaluation to JavaScript via EMSCRIPTEN_KEEPALIVE entry points.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of version 3 or later of the GNU General Public License as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 */

#include "config.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "backgammon.h"
#include "eval.h"
#include "positionid.h"
#include "matchid.h"
#include "drawboard.h"

/* Engine-side analysis state.  The board is always stored from the
 * perspective of the player on roll (anBoard[1] = player on roll), which
 * is the GNU Backgammon Position ID convention.  The cubeinfo is kept in
 * sync so that equities are computed for the player on roll. */
static TanBoard s_anBoard;
static cubeinfo s_ci;
static int s_fStateValid = 0;

#define WEB_API_OUT_SIZE 32768
static char s_szOut[WEB_API_OUT_SIZE];

static const char *
json_error(const char *szMsg)
{
    snprintf(s_szOut, WEB_API_OUT_SIZE, "{\"error\":\"%s\"}", szMsg);
    return s_szOut;
}

static void
default_cubeinfo(cubeinfo * pci)
{
    static const int anScore[2] = { 0, 0 };
    /* money game, centred cube, Jacoby off so cubeless/cubeful equities
     * match the values players see in gnubg's default analysis */
    SetCubeInfo(pci, 1, -1, 0, 0, anScore, FALSE, FALSE, FALSE, VARIATION_STANDARD);
}

static void
make_evalcontext(evalcontext * pec, int nPlies)
{
    if (nPlies < 0)
        nPlies = 0;
    if (nPlies > 3)
        nPlies = 3;

    pec->fCubeful = TRUE;
    pec->nPlies = (unsigned int) nPlies;
    pec->fUsePrune = TRUE;
    pec->fDeterministic = TRUE;
    pec->rNoise = 0.0f;
}

/* Set the position to analyse from a GNU Backgammon Position ID.
 * Resets cube state to a centred money-game cube; call web_set_cube()
 * or web_set_matchid() afterwards to override.
 * Returns 0 on success, -1 on parse failure. */
int
EMSCRIPTEN_KEEPALIVE
web_set_position(const char *szPosId)
{
    if (!szPosId || strlen(szPosId) < 14 - 1)
        return -1;

    if (!PositionFromID(s_anBoard, szPosId))
        return -1;

    default_cubeinfo(&s_ci);
    s_fStateValid = 1;
    return 0;
}

/* Override cube/match state.  fCubeOwner: -1 centred, 0 player on roll,
 * 1 opponent.  nMatchTo 0 = money game.  Scores are (on roll, opponent).
 * Returns 0 on success. */
int
EMSCRIPTEN_KEEPALIVE
web_set_cube(int nCube, int fCubeOwner, int nMatchTo, int nScore0, int nScore1, int fCrawford, int fJacoby)
{
    int anScore[2];

    anScore[0] = nScore0;
    anScore[1] = nScore1;

    if (SetCubeInfo(&s_ci, nCube, fCubeOwner, 0, nMatchTo, anScore, fCrawford, fJacoby, FALSE, VARIATION_STANDARD) < 0)
        return -1;
    return 0;
}

/* Set cube/match state from a GNU Backgammon Match ID.  The board set via
 * web_set_position() is interpreted from the on-roll player's perspective,
 * so the cubeinfo is normalised to fMove = 0 (scores and cube owner are
 * swapped when the match ID has player 1 on roll).
 * Returns the dice encoded in the match ID packed as die1*10+die2 (0 if
 * no dice rolled), or -1 on parse failure. */
int
EMSCRIPTEN_KEEPALIVE
web_set_matchid(const char *szMatchId)
{
    unsigned int anDice[2];
    int fTurn, fResigned, fDoubled, fMove, fCubeOwner, fCrawford;
    int nMatchTo, anScore[2], nCube, fJacoby;
    gamestate gs;
    int anScoreNorm[2];
    int fCubeOwnerNorm;

    if (!szMatchId)
        return -1;

    if (MatchFromID(anDice, &fTurn, &fResigned, &fDoubled, &fMove, &fCubeOwner,
                    &fCrawford, &nMatchTo, anScore, &nCube, &fJacoby, &gs, szMatchId) < 0)
        return -1;

    /* normalise to the on-roll player's perspective */
    if (fMove == 1) {
        anScoreNorm[0] = anScore[1];
        anScoreNorm[1] = anScore[0];
        fCubeOwnerNorm = (fCubeOwner == -1) ? -1 : !fCubeOwner;
    } else {
        anScoreNorm[0] = anScore[0];
        anScoreNorm[1] = anScore[1];
        fCubeOwnerNorm = fCubeOwner;
    }

    if (SetCubeInfo(&s_ci, nCube, fCubeOwnerNorm, 0, nMatchTo, anScoreNorm,
                    fCrawford, fJacoby, FALSE, VARIATION_STANDARD) < 0)
        return -1;

    return (int) (anDice[0] * 10 + anDice[1]);
}

/* Current position as a Position ID string (round-trip check). */
const char *
EMSCRIPTEN_KEEPALIVE
web_get_position(void)
{
    if (!s_fStateValid)
        return json_error("no position set");

    snprintf(s_szOut, WEB_API_OUT_SIZE, "%s", PositionID((ConstTanBoard) s_anBoard));
    return s_szOut;
}

static void
append_probs(char **ppch, size_t *pcch, const float ar[])
{
    int n = snprintf(*ppch, *pcch,
                     "{\"win\":%.4f,\"winG\":%.4f,\"winBG\":%.4f,\"loseG\":%.4f,\"loseBG\":%.4f}",
                     ar[OUTPUT_WIN], ar[OUTPUT_WINGAMMON], ar[OUTPUT_WINBACKGAMMON],
                     ar[OUTPUT_LOSEGAMMON], ar[OUTPUT_LOSEBACKGAMMON]);
    *ppch += n;
    *pcch -= (size_t) n;
}

/* Analyse a chequer play.  Returns a JSON MoveList: ranked moves with
 * cubeful equities, best first, top 5. */
const char *
EMSCRIPTEN_KEEPALIVE
web_analyze_move(int nDie1, int nDie2, int nPlies)
{
    evalcontext ec;
    movelist ml;
    unsigned int i, cShow;
    char *pch = s_szOut;
    size_t cch = WEB_API_OUT_SIZE;
    int n;
    float rBest = 0.0f;

    if (!s_fStateValid)
        return json_error("no position set");
    if (nDie1 < 1 || nDie1 > 6 || nDie2 < 1 || nDie2 > 6)
        return json_error("invalid dice");

    make_evalcontext(&ec, nPlies);

    if (FindnSaveBestMoves(&ml, nDie1, nDie2, (ConstTanBoard) s_anBoard, NULL, 0.0f,
                           &s_ci, &ec, aamfEval) < 0)
        return json_error("analysis failed");

    if (!ml.cMoves) {
        free(ml.amMoves);
        snprintf(s_szOut, WEB_API_OUT_SIZE, "{\"moves\":[]}");
        return s_szOut;
    }

    rBest = ml.amMoves[0].rScore;

    n = snprintf(pch, cch, "{\"moves\":[");
    pch += n;
    cch -= (size_t) n;

    cShow = ml.cMoves < 5 ? ml.cMoves : 5;
    for (i = 0; i < cShow; i++) {
        char szMove[128];
        move *pm = &ml.amMoves[i];

        FormatMove(szMove, (ConstTanBoard) s_anBoard, pm->anMove);

        n = snprintf(pch, cch, "%s{\"move\":\"%s\",\"equity\":%.4f,\"diff\":%.4f,\"probs\":",
                     i ? "," : "", szMove, pm->rScore, pm->rScore - rBest);
        pch += n;
        cch -= (size_t) n;

        append_probs(&pch, &cch, pm->arEvalMove);

        n = snprintf(pch, cch, "}");
        pch += n;
        cch -= (size_t) n;
    }

    snprintf(pch, cch, "],\"totalMoves\":%u}", ml.cMoves);

    free(ml.amMoves);
    return s_szOut;
}

/* Analyse the cube decision for the player on roll. */
const char *
EMSCRIPTEN_KEEPALIVE
web_analyze_cube(int nPlies)
{
    evalcontext ec;
    float aarOutput[2][NUM_ROLLOUT_OUTPUTS];
    float arDouble[4];
    cubedecision cd;
    char *pch = s_szOut;
    size_t cch = WEB_API_OUT_SIZE;
    int n;

    if (!s_fStateValid)
        return json_error("no position set");

    make_evalcontext(&ec, nPlies);

    if (GeneralCubeDecisionE(aarOutput, (ConstTanBoard) s_anBoard, &s_ci, &ec, NULL) < 0)
        return json_error("analysis failed");

    cd = FindCubeDecision(arDouble, aarOutput, &s_ci);

    n = snprintf(pch, cch,
                 "{\"decision\":\"%s\",\"equities\":{\"optimal\":%.4f,\"noDouble\":%.4f,"
                 "\"doubleTake\":%.4f,\"doublePass\":%.4f},\"probs\":",
                 GetCubeRecommendation(cd),
                 arDouble[OUTPUT_OPTIMAL], arDouble[OUTPUT_NODOUBLE],
                 arDouble[OUTPUT_TAKE], arDouble[OUTPUT_DROP]);
    pch += n;
    cch -= (size_t) n;

    append_probs(&pch, &cch, aarOutput[0]);

    snprintf(pch, cch, "}");
    return s_szOut;
}

/* Static evaluation of the current position for the player on roll. */
const char *
EMSCRIPTEN_KEEPALIVE
web_evaluate(int nPlies)
{
    evalcontext ec;
    float arOutput[NUM_ROLLOUT_OUTPUTS];
    char *pch = s_szOut;
    size_t cch = WEB_API_OUT_SIZE;
    int n;

    if (!s_fStateValid)
        return json_error("no position set");

    make_evalcontext(&ec, nPlies);

    if (GeneralEvaluationE(arOutput, (ConstTanBoard) s_anBoard, &s_ci, &ec) < 0)
        return json_error("analysis failed");

    n = snprintf(pch, cch, "{\"equity\":%.4f,\"cubefulEquity\":%.4f,\"probs\":",
                 arOutput[OUTPUT_EQUITY], arOutput[OUTPUT_CUBEFUL_EQUITY]);
    pch += n;
    cch -= (size_t) n;

    append_probs(&pch, &cch, arOutput);

    snprintf(pch, cch, "}");
    return s_szOut;
}
