/**
 * JUnit XML importer — gives every framework (TestNG, pytest, Cucumber-JVM, Jest...)
 * basic support. Zero dependencies: a small tolerant XML parser is included.
 */
import type { RawRun } from '../types.js';
interface XmlNode {
    name: string;
    attrs: Record<string, string>;
    children: XmlNode[];
    text: string;
}
export declare function parseXml(xml: string): XmlNode;
export declare function importJUnit(xml: string, sourceName?: string): RawRun;
export {};
