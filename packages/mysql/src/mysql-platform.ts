/*
 * Deepkit Framework
 * Copyright (C) 2021 Deepkit UG, Marc J. Schmidt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 *
 * You should have received a copy of the MIT License along with this program.
 */

import { Pool } from 'mariadb';
import { mySqlSerializer } from './mysql-serializer';
import { MySQLOptions, PropertySchema } from '@deepkit/type';
import { Column, DefaultPlatform, parseType } from '@deepkit/sql';
import { MysqlSchemaParser } from './mysql-schema-parser';

export class MySQLPlatform extends DefaultPlatform {
    protected defaultSqlType = 'longtext';
    schemaParserType = MysqlSchemaParser;

    public readonly serializer = mySqlSerializer;

    constructor(protected pool: Pool) {
        super();

        this.nativeTypeInformation.set('blob', { needsIndexPrefix: true, defaultIndexSize: 767 });
        this.nativeTypeInformation.set('longtext', { needsIndexPrefix: true, defaultIndexSize: 767 });
        this.nativeTypeInformation.set('longblob', { needsIndexPrefix: true, defaultIndexSize: 767 });

        this.addType('number', 'double');
        this.addType('date', 'datetime');
        this.addType('boolean', 'tinyint', 1);
        this.addType('uuid', 'binary', 16);

        this.addType('class', 'json');
        this.addType('array', 'json');
        this.addType('union', 'json');
        this.addType('partial', 'json');
        this.addType('map', 'json');
        this.addType('patch', 'json');

        this.addBinaryType('longblob');
    }

    protected setColumnType(column: Column, typeProperty: PropertySchema) {
        const db = (typeProperty.data['mysql'] || {}) as MySQLOptions;
        if (db.type) {
            parseType(column, db.type);
            return;
        }

        super.setColumnType(column, typeProperty);
    }

    quoteValue(value: any): string {
        return this.pool.escape(value);
    }

    quoteIdentifier(id: string): string {
        return this.pool.escapeId(id);
    }

    getAutoIncrement() {
        return 'AUTO_INCREMENT';
    }

    getBeginDDL(): string {
        return `
# This is a fix for InnoDB in MySQL >= 4.1.x
# It "suspends judgement" for foreign key relationships until all tables are set.
SET FOREIGN_KEY_CHECKS = 0;`;
    }

    getEndDDL(): string {
        return `
# This restores the foreign key checks, after having unset them earlier
SET FOREIGN_KEY_CHECKS = 1;`;
    }
}
