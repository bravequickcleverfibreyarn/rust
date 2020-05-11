import * as os from "os";
import * as vscode from 'vscode';
import * as ra from './rust-analyzer-api';

import { Cargo } from './cargo';
import { Ctx } from "./ctx";

const debugOutput = vscode.window.createOutputChannel("Debug");
type DebugConfigProvider = (config: ra.Runnable, executable: string, sourceFileMap?: Record<string, string>) => vscode.DebugConfiguration;

function getLldbDebugConfig(config: ra.Runnable, executable: string, sourceFileMap?: Record<string, string>): vscode.DebugConfiguration {
    return {
        type: "lldb",
        request: "launch",
        name: config.label,
        program: executable,
        args: config.extraArgs,
        cwd: config.cwd,
        sourceMap: sourceFileMap,
        sourceLanguages: ["rust"]
    };
}

function getCppvsDebugConfig(config: ra.Runnable, executable: string, sourceFileMap?: Record<string, string>): vscode.DebugConfiguration {
    return {
        type: (os.platform() === "win32") ? "cppvsdbg" : "cppdbg",
        request: "launch",
        name: config.label,
        program: executable,
        args: config.extraArgs,
        cwd: config.cwd,
        sourceFileMap: sourceFileMap,
    };
}

async function getDebugExecutable(config: ra.Runnable): Promise<string> {
    const cargo = new Cargo(config.cwd || '.', debugOutput);
    const executable = await cargo.executableFromArgs(config.args);

    // if we are here, there were no compilation errors.
    return executable;
}

export async function getDebugConfiguration(ctx: Ctx, config: ra.Runnable): Promise<vscode.DebugConfiguration | undefined> {
    const editor = ctx.activeRustEditor;
    if (!editor) return;

    const knownEngines: Record<string, DebugConfigProvider> = {
        "vadimcn.vscode-lldb": getLldbDebugConfig,
        "ms-vscode.cpptools": getCppvsDebugConfig
    };
    const debugOptions = ctx.config.debug;

    let debugEngine = null;
    if (debugOptions.engine === "auto") {
        for (var engineId in knownEngines) {
            debugEngine = vscode.extensions.getExtension(engineId);
            if (debugEngine) break;
        }
    } else {
        debugEngine = vscode.extensions.getExtension(debugOptions.engine);
    }

    if (!debugEngine) {
        vscode.window.showErrorMessage(`Install [CodeLLDB](https://marketplace.visualstudio.com/items?itemName=vadimcn.vscode-lldb)`
            + ` or [MS C++ tools](https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools) extension for debugging.`);
        return;
    }

    debugOutput.clear();
    if (ctx.config.debug.openUpDebugPane) {
        debugOutput.show(true);
    }

    const executable = await getDebugExecutable(config);
    const debugConfig = knownEngines[debugEngine.id](config, executable, debugOptions.sourceFileMap);
    if (debugConfig.type in debugOptions.engineSettings) {
        const settingsMap = (debugOptions.engineSettings as any)[debugConfig.type];
        for (var key in settingsMap) {
            debugConfig[key] = settingsMap[key];
        }
    }

    return debugConfig;
}

export async function startDebugSession(ctx: Ctx, config: ra.Runnable): Promise<boolean> {
    const debugConfig = await getDebugConfiguration(ctx, config);
    if (!debugConfig) return false;

    debugOutput.appendLine("Launching debug configuration:");
    debugOutput.appendLine(JSON.stringify(debugConfig, null, 2));
    return vscode.debug.startDebugging(undefined, debugConfig);
}
