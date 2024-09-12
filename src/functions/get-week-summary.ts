import dayjs from "dayjs";
import { db } from "../db";
import { and, gte, lte, count, eq, sql } from "drizzle-orm";
import { goalCompletions, goals } from "../db/schema";

export async function getWeekSummary() {
	const firstDayOfWeek = dayjs().startOf("week").toDate();
	const lastDayOfWeek = dayjs().endOf("week").toDate();

	const goalsCreateUpToWeek = db.$with("goals_create_up_to_week").as(
		db
			.select({
				id: goals.id,
				title: goals.title,
				desiredWeeklyFrequency: goals.desiredWeeklyFrequency,
				createAt: goals.createdAt,
			})
			.from(goals)
			.where(lte(goals.createdAt, lastDayOfWeek)),
	);

	const goalsCompletedInWeek = db.$with("goal_completed_in_week").as(
		db
			.select({
				id: goalCompletions.id,
				title: goals.title,
				completedAt: goalCompletions.createdAt,
				completedAtDate: sql /* sql */`
                    DATE(${goalCompletions.createdAt}) 
                `.as("completedAtDate"),
			})
			.from(goalCompletions)
			.innerJoin(goals, eq(goals.id, goalCompletions.goalId))
			.where(
				and(
					gte(goalCompletions.createdAt, firstDayOfWeek),
					lte(goalCompletions.createdAt, lastDayOfWeek),
				),
			),
	);

	const goalsCompletedByWeekDay = db.$with("goals_completed_by_week_day").as(
		db
			.select({
				completedAtDate: goalsCompletedInWeek.completedAtDate,
				completions: sql /* sql */`
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id', ${goalsCompletedInWeek.id},
                            'title', ${goalsCompletedInWeek.title},
                            'completedAt', ${goalsCompletedInWeek.completedAt}
                        )
                    )
                `.as("completions"),
			})
			.from(goalsCompletedInWeek)
			.groupBy(goalsCompletedInWeek.completedAtDate),
	);

	const result = await db
		.with(goalsCreateUpToWeek, goalsCompletedInWeek, goalsCompletedByWeekDay)
		.select({
			completed: sql /* sql */`(
                SELECT COUNT(*) FROM ${goalsCompletedInWeek}
            )`.mapWith(Number),
			total: sql /* sql */`(
                SELECT SUM(${goalsCreateUpToWeek.desiredWeeklyFrequency}) FROM ${goalsCreateUpToWeek}
            )`.mapWith(Number),
            goalsPerDay: sql /* sql */ `
                JSON_OBJECT_AGG(
                    ${goalsCompletedByWeekDay.completedAtDate},
                    ${goalsCompletedByWeekDay.completions}
                )
            `
		})
		.from(goalsCompletedByWeekDay);

	return {
		summary: result,
	};
}