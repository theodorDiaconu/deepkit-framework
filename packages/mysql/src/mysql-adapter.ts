/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { createPool, Pool, PoolConfig, PoolConnection, UpsertResult } from 'mariadb';
import {
    DefaultPlatform,
    SqlBuilder,
    SQLConnection,
    SQLConnectionPool,
    SQLDatabaseAdapter,
    SQLDatabaseQuery,
    SQLDatabaseQueryFactory,
    SQLPersistence,
    SQLQueryModel,
    SQLQueryResolver,
    SQLStatement
} from '@deepkit/sql';
import { DatabaseLogger, DatabasePersistenceChangeSet, DatabaseSession, DatabaseTransaction, DeleteResult, Entity, PatchResult } from '@deepkit/orm';
import { MySQLPlatform } from './mysql-platform';
import {
    Changes,
    ClassSchema,
    getClassSchema,
    getPropertyXtoClassFunction,
    isArray,
    resolvePropertySchema
} from '@deepkit/type';
import { asyncOperation, ClassType, empty } from '@deepkit/core';

export class MySQLStatement extends SQLStatement {
    constructor(protected logger: DatabaseLogger, protected sql: string, protected connection: PoolConnection) {
        super();
    }

    async get(params: any[] = []) {
        try {
            //mysql/mariadb driver does not maintain error.stack when they throw errors, so
            //we have to manually convert it using asyncOperation.
            const rows = await asyncOperation<any[]>((resolve, reject) => {
                this.connection.query(this.sql, params).then(resolve).catch(reject);
            });
            this.logger.logQuery(this.sql, params);
            return rows[0];
        } catch (error) {
            this.logger.failedQuery(error, this.sql, params);
            throw error;
        }
    }

    async all(params: any[] = []) {
        try {
            //mysql/mariadb driver does not maintain error.stack when they throw errors, so
            //we have to manually convert it using asyncOperation.
            const rows = await asyncOperation<any[]>((resolve, reject) => {
                this.connection.query(this.sql, params).then(resolve).catch(reject);
            });
            this.logger.logQuery(this.sql, params);
            return rows;
        } catch (error) {
            this.logger.failedQuery(error, this.sql, params);
            throw error;
        }
    }

    release() {
    }
}

export class MySQLConnection extends SQLConnection {
    protected changes: number = 0;
    public lastExecResult?: UpsertResult[];
    protected connector?: Promise<PoolConnection>;

    constructor(
        connectionPool: SQLConnectionPool,
        public connection: PoolConnection,
        logger?: DatabaseLogger
    ) {
        super(connectionPool, logger);
    }

    async prepare(sql: string) {
        return new MySQLStatement(this.logger, sql, this.connection);
    }

    async run(sql: string, params: any[] = []) {
        //batch returns in reality a single UpsertResult if only one query is given
        try {
            const res = (await this.connection.query(sql, params)) as UpsertResult[] | UpsertResult;
            this.logger.logQuery(sql, params);
            this.lastExecResult = isArray(res) ? res : [res];
        } catch (error) {
            this.logger.failedQuery(error, sql, params);
            throw error;
        }
    }

    async getChanges(): Promise<number> {
        return this.changes;
    }
}

export class MySQLConnectionPool extends SQLConnectionPool {
    constructor(protected pool: Pool) {
        super();
    }

    async getConnection(logger?: DatabaseLogger, transaction?: DatabaseTransaction): Promise<MySQLConnection> {
        //todo: handle transaction, when given we make sure we return a sticky connection to the transaction
        // and release the stickiness when transaction finished.

        this.activeConnections++;
        return new MySQLConnection(this, await this.pool.getConnection(), logger);
    }

    release(connection: MySQLConnection) {
        connection.connection.release();
        super.release(connection);
    }
}

export class MySQLPersistence extends SQLPersistence {
    constructor(protected platform: DefaultPlatform, public connectionPool: MySQLConnectionPool, session: DatabaseSession<any>) {
        super(platform, connectionPool, session);
    }

    async batchUpdate<T extends Entity>(classSchema: ClassSchema<T>, changeSets: DatabasePersistenceChangeSet<T>[]): Promise<void> {
        const scopeSerializer = this.platform.serializer.for(classSchema);
        const tableName = this.platform.getTableIdentifier(classSchema);
        const pkName = classSchema.getPrimaryField().name;
        const pkField = this.platform.quoteIdentifier(pkName);

        const values: { [name: string]: any[] } = {};
        const setNames: string[] = [];
        const aggregateSelects: { [name: string]: { id: any, sql: string }[] } = {};
        const requiredFields: { [name: string]: 1 } = {};

        const assignReturning: { [name: string]: { item: any, names: string[] } } = {};
        const setReturning: { [name: string]: 1 } = {};

        for (const changeSet of changeSets) {
            const where: string[] = [];

            const pk = scopeSerializer.partialSerialize(changeSet.primaryKey);
            for (const i in pk) {
                if (!pk.hasOwnProperty(i)) continue;
                where.push(`${this.platform.quoteIdentifier(i)} = ${this.platform.quoteValue(pk[i])}`);
                requiredFields[i] = 1;
            }

            if (!values[pkName]) values[pkName] = [];
            values[pkName].push(this.platform.quoteValue(changeSet.primaryKey[pkName]));

            const fieldAddedToValues: { [name: string]: 1 } = {};
            const id = changeSet.primaryKey[pkName];

            if (changeSet.changes.$set) {
                const value = scopeSerializer.partialSerialize(changeSet.changes.$set);
                for (const i in value) {
                    if (!value.hasOwnProperty(i)) continue;
                    if (!values[i]) {
                        values[i] = [];
                        setNames.push(`${tableName}.${this.platform.quoteIdentifier(i)} = _b.${this.platform.quoteIdentifier(i)}`);
                    }
                    requiredFields[i] = 1;
                    fieldAddedToValues[i] = 1;
                    values[i].push(this.platform.quoteValue(value[i]));
                }
            }

            if (changeSet.changes.$inc) {
                for (const i in changeSet.changes.$inc) {
                    if (!changeSet.changes.$inc.hasOwnProperty(i)) continue;
                    const value = changeSet.changes.$inc[i];
                    if (!aggregateSelects[i]) aggregateSelects[i] = [];

                    if (!values[i]) {
                        values[i] = [];
                        setNames.push(`${tableName}.${this.platform.quoteIdentifier(i)} = _b.${this.platform.quoteIdentifier(i)}`);
                    }

                    if (!assignReturning[id]) {
                        assignReturning[id] = { item: changeSet.item, names: [] };
                    }

                    assignReturning[id].names.push(i);
                    setReturning[i] = 1;

                    aggregateSelects[i].push({
                        id: changeSet.primaryKey[pkName],
                        sql: `_origin.${this.platform.quoteIdentifier(i)} + ${this.platform.quoteValue(value)}`
                    });
                    requiredFields[i] = 1;
                    if (!fieldAddedToValues[i]) {
                        fieldAddedToValues[i] = 1;
                        values[i].push(this.platform.quoteValue(null));
                    }
                }
            }
        }

        const selects: string[] = [];
        const valuesValues: string[] = [];
        const valuesNames: string[] = [];
        for (const i in values) {
            valuesNames.push(i);
        }

        for (let i = 0; i < values[pkName].length; i++) {
            valuesValues.push('ROW(' + valuesNames.map(name => values[name][i]).join(',') + ')');
        }

        for (const i in requiredFields) {
            if (aggregateSelects[i]) {
                const select: string[] = [];
                select.push('CASE');
                for (const item of aggregateSelects[i]) {
                    select.push(`WHEN _.${pkField} = ${item.id} THEN ${item.sql}`);
                }
                select.push(`ELSE _.${this.platform.quoteIdentifier(i)} END as ${this.platform.quoteIdentifier(i)}`);
                selects.push(select.join(' '));
            } else {
                selects.push('_.' + i);
            }
        }

        let setVars = '';
        let endSelect = '';
        if (!empty(setReturning)) {
            const vars: string[] = [];
            const endSelectVars: string[] = [];
            vars.push(`@_pk := JSON_ARRAYAGG(${pkField})`);
            endSelectVars.push('@_pk');
            for (const i in setReturning) {
                endSelectVars.push(`@_f_${i}`);
                vars.push(`@_f_${i} := JSON_ARRAYAGG(${this.platform.quoteIdentifier(i)})`);
            }
            setVars = `,
                (SELECT ${vars.join(', ')} FROM _tmp GROUP BY '0') as _
            `;
            endSelect = `SELECT ${endSelectVars.join(', ')};`;
        }

        const sql = `
              WITH _tmp(${valuesNames.join(', ')}) AS (
                SELECT ${selects.join(', ')} FROM 
                    (VALUES ${valuesValues.join(', ')}) as _(${valuesNames.join(', ')})
                    INNER JOIN ${tableName} as _origin ON (_origin.${pkField} = _.${pkField})
              )
              UPDATE 
                ${tableName}, _tmp as _b ${setVars}
                
              SET ${setNames.join(', ')}
              WHERE ${tableName}.${pkField} = _b.${pkField};
              ${endSelect}
        `;

        const connection = await this.getConnection(); //will automatically be released in SQLPersistence
        const result = await connection.execAndReturnAll(sql);

        if (!empty(setReturning)) {
            const returning = result[1][0];
            const ids = JSON.parse(returning['@_pk']) as (number | string)[];
            const parsedReturning: { [name: string]: any[] } = {};
            for (const i in setReturning) {
                parsedReturning[i] = JSON.parse(returning['@_f_' + i]) as any[];
            }

            for (let i = 0; i < ids.length; i++) {
                const id = ids[i];
                const r = assignReturning[id];
                if (!r) continue;

                for (const name of r.names) {
                    r.item[name] = parsedReturning[name][i];
                }
            }
        }
    }

    protected async populateAutoIncrementFields<T>(classSchema: ClassSchema<T>, items: T[]) {
        const autoIncrement = classSchema.getAutoIncrementField();
        if (!autoIncrement) return;
        const connection = await this.getConnection(); //will automatically be released in SQLPersistence

        if (!connection.lastExecResult || !connection.lastExecResult.length) throw new Error('No lastBatchResult found');

        //MySQL returns the _first_ auto-incremented value for a batch insert.
        //It's guaranteed to increment always by one (expect if the user provides a manual auto-increment value in between, which should be forbidden).
        //So since we know how many items were inserted, we can simply calculate for each item the auto-incremented value.
        const result = connection.lastExecResult[0];
        let start = result.insertId;

        for (const item of items) {
            item[autoIncrement.name] = start++;
        }
    }
}

export class MySQLQueryResolver<T extends Entity> extends SQLQueryResolver<T> {
    async delete(model: SQLQueryModel<T>, deleteResult: DeleteResult<T>): Promise<void> {
        const primaryKey = this.classSchema.getPrimaryField();
        const pkField = this.platform.quoteIdentifier(primaryKey.name);
        const primaryKeyConverted = getPropertyXtoClassFunction(primaryKey, this.platform.serializer);

        const sqlBuilder = new SqlBuilder(this.platform);
        const select = sqlBuilder.select(this.classSchema, model, { select: [pkField] });
        const tableName = this.platform.getTableIdentifier(this.classSchema);

        const connection = await this.connectionPool.getConnection(this.session.logger, this.session.transaction);
        try {
            const sql = `
                WITH _ AS (${select.sql})
                DELETE ${tableName}
                FROM ${tableName} INNER JOIN _ INNER JOIN (SELECT @_pk := JSON_ARRAYAGG(${pkField}) FROM _ GROUP BY '0') as _pk
                WHERE ${tableName}.${pkField} = _.${pkField};
                SELECT @_pk
            `;

            const rows = await connection.execAndReturnAll(sql, select.params);
            const returning = rows[1];
            const pk = returning[0]['@_pk'];
            if (pk) deleteResult.primaryKeys = JSON.parse(pk).map(primaryKeyConverted);
            deleteResult.modified = deleteResult.primaryKeys.length;
        } finally {
            connection.release();
        }
    }

    async patch(model: SQLQueryModel<T>, changes: Changes<T>, patchResult: PatchResult<T>): Promise<void> {
        const select: string[] = [];
        const selectParams: any[] = [];
        const tableName = this.platform.getTableIdentifier(this.classSchema);
        const primaryKey = this.classSchema.getPrimaryField();
        const primaryKeyConverted = getPropertyXtoClassFunction(primaryKey, this.platform.serializer);

        const fieldsSet: { [name: string]: 1 } = {};
        const aggregateFields: { [name: string]: { converted: (v: any) => any } } = {};

        const scopeSerializer = this.platform.serializer.for(this.classSchema);
        const $set = changes.$set ? scopeSerializer.partialSerialize(changes.$set) : undefined;

        if ($set) for (const i in $set) {
            if (!$set.hasOwnProperty(i)) continue;
            fieldsSet[i] = 1;
            select.push(`? as ${this.platform.quoteIdentifier(i)}`);
            selectParams.push($set[i]);
        }

        if (changes.$unset) for (const i in changes.$unset) {
            if (!changes.$unset.hasOwnProperty(i)) continue;
            fieldsSet[i] = 1;
            select.push(`NULL as ${this.platform.quoteIdentifier(i)}`);
        }

        for (const i of model.returning) {
            aggregateFields[i] = { converted: getPropertyXtoClassFunction(resolvePropertySchema(this.classSchema, i), this.platform.serializer) };
            select.push(`(${this.platform.quoteIdentifier(i)} ) as ${this.platform.quoteIdentifier(i)}`);
        }

        if (changes.$inc) for (const i in changes.$inc) {
            if (!changes.$inc.hasOwnProperty(i)) continue;
            fieldsSet[i] = 1;
            aggregateFields[i] = { converted: getPropertyXtoClassFunction(resolvePropertySchema(this.classSchema, i), this.platform.serializer) };
            select.push(`(${this.platform.quoteIdentifier(i)} + ${this.platform.quoteValue(changes.$inc[i])}) as ${this.platform.quoteIdentifier(i)}`);
        }

        const set: string[] = [];
        for (const i in fieldsSet) {
            set.push(`_target.${this.platform.quoteIdentifier(i)} = b.${this.platform.quoteIdentifier(i)}`);
        }

        const extractSelect: string[] = [];
        const selectVars: string[] = [];
        let bPrimaryKey = primaryKey.name;
        //we need a different name because primaryKeys could be updated as well
        if (fieldsSet[primaryKey.name]) {
            select.unshift(this.platform.quoteIdentifier(primaryKey.name) + ' as __' + primaryKey.name);
            bPrimaryKey = '__' + primaryKey.name;
        } else {
            select.unshift(this.platform.quoteIdentifier(primaryKey.name));
        }

        extractSelect.push(`@_pk := JSON_ARRAYAGG(${this.platform.quoteIdentifier(primaryKey.name)})`);
        selectVars.push(`@_pk`);
        if (!empty(aggregateFields)) {
            for (const i in aggregateFields) {
                extractSelect.push(`@_f_${i} := JSON_ARRAYAGG(${this.platform.quoteIdentifier(i)})`);
                selectVars.push(`@_f_${i}`);
            }
        }
        const extractVarsSQL = `,
                (SELECT ${extractSelect.join(', ')} FROM _tmp GROUP BY '0') as _
            `;
        const selectVarsSQL = `SELECT ${selectVars.join(', ')};`;

        const sqlBuilder = new SqlBuilder(this.platform);
        const selectSQL = sqlBuilder.select(this.classSchema, model, { select }, selectParams);

        const params = selectSQL.params;
        const sql = `
            WITH _tmp AS (${selectSQL.sql})
            UPDATE
                ${tableName} as _target, _tmp as b ${extractVarsSQL}
            SET
                ${set.join(', ')}
            WHERE _target.${this.platform.quoteIdentifier(primaryKey.name)} = b.${this.platform.quoteIdentifier(bPrimaryKey)};
            ${selectVarsSQL}
        `;

        const connection = await this.connectionPool.getConnection(this.session.logger, this.session.transaction);
        try {
            const result = await connection.execAndReturnAll(sql, params);
            const packet = result[0];
            patchResult.modified = packet.affectedRows;
            const returning = result[1][0];
            patchResult.primaryKeys = (JSON.parse(returning['@_pk']) as any[]).map(primaryKeyConverted as any);

            for (const i in aggregateFields) {
                patchResult.returning[i] = (JSON.parse(returning['@_f_' + i]) as any[]).map(aggregateFields[i].converted);
            }

        } finally {
            connection.release();
        }
    }
}

export class MySQLDatabaseQuery<T> extends SQLDatabaseQuery<T> {
}

export class MySQLDatabaseQueryFactory extends SQLDatabaseQueryFactory {
    createQuery<T extends Entity>(classType: ClassType<T> | ClassSchema<T>): MySQLDatabaseQuery<T> {
        return new MySQLDatabaseQuery(getClassSchema(classType), this.databaseSession,
            new MySQLQueryResolver(this.connectionPool, this.platform, getClassSchema(classType), this.databaseSession)
        );
    }
}

export class MySQLDatabaseAdapter extends SQLDatabaseAdapter {
    protected pool = createPool({ multipleStatements: true, maxAllowedPacket: 16_000_000, ...this.options });
    public connectionPool = new MySQLConnectionPool(this.pool);
    public platform = new MySQLPlatform(this.pool);

    constructor(
        protected options: PoolConfig = {}
    ) {
        super();
    }

    getName(): string {
        return 'mysql';
    }

    getSchemaName(): string {
        //todo extract schema name from connection options. This acts as default when a table has no schemaName defined.
        return '';
    }

    createPersistence(session: DatabaseSession<any>): SQLPersistence {
        return new MySQLPersistence(this.platform, this.connectionPool, session);
    }

    queryFactory(databaseSession: DatabaseSession<any>): MySQLDatabaseQueryFactory {
        return new MySQLDatabaseQueryFactory(this.connectionPool, this.platform, databaseSession);
    }

    disconnect(force?: boolean): void {
        this.pool.end().catch(console.error);
    }
}
