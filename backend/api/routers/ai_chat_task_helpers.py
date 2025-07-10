from typing import Any, Dict, Optional
import asyncio
import logging
import inspect
import json
import sys
from openai import AsyncOpenAI
from backend.api.routers.tasks import system_task_manager, TaskManager

logger = logging.getLogger(__name__)

async def generate_intelligent_chat_response(message, context, is_user_admin):
    """Generate an intelligent chat response (fallback to LLM)."""
    if context and 'center' in context:
        return f"[AI] {message} (map center: {context['center']}, admin: {is_user_admin})"
    return f"[AI] {message} (context: {context}, admin: {is_user_admin})"

def get_task_command_json_schema_from_taskmanager() -> str:
    """
    Dynamically extract the supported actions and their required fields from TaskManager docstring.
    Accepts both 'Supported actions and required fields' and 'Unified actions:' as section headers.
    """
    doc = inspect.getdoc(TaskManager)
    if not doc:
        return "{}"
    import re
    actions = {}
    in_section = False
    for line in doc.splitlines():
        if (
            'Supported actions and required fields' in line
            or 'Unified actions:' in line
        ):
            in_section = True
            continue
        if in_section:
            if not line.strip() or line.strip().startswith('The return value'):
                break
            m = re.match(r'- (\w+):\s*({.*})', line.strip())
            if m:
                action = m.group(1)
                try:
                    fields = json.loads(m.group(2).replace("'", '"'))
                except Exception:
                    fields = m.group(2)
                actions[action] = fields
    return json.dumps(actions, indent=2)

def generate_task_system_prompt(context: dict = None) -> str:
    """
    Generates a system prompt for the LLM describing how to format task commands for the TaskManager.
    Instructs the LLM to always provide a conversational response, and only output a JSON task command if the user request matches a known action (except for listing tasks).
    The LLM should answer all task status or list queries directly from the current task list, which is always included in the context, and must never issue a "list" command or output a JSON for listing tasks.
    Includes only non-user context (e.g., location, coordinates) in the prompt.
    The LLM should extract all relevant details (such as task IDs, coordinates, profiles, etc.) from the user's message and fill in the JSON command as completely as possible.
    If the user provides a task ID, coordinates, or other arguments, always include them in the JSON output.
    If the user omits required fields, ask for clarification in a conversational way, but do not output incomplete JSON.
    """
    import inspect
    json_schema = get_task_command_json_schema_from_taskmanager()
    context_lines = []
    # Always include a summary of the current task list at the top of the context
    try:
        tasks = system_task_manager.list_tasks()
        # Log the current task list for debugging LLM context
        if tasks:
            context_lines.append("Current tasks:")
            for t in tasks:
                # Ensure t is a dict (for compatibility with both Task objects and dicts)
                t_dict = t.to_dict() if hasattr(t, 'to_dict') else t
                desc = t_dict.get('description') or t_dict.get('profiles') or ''
                if t_dict.get('start_coordinates', []):
                    desc += f" at coordinates {t_dict.get('start_coordinates')}"
                if t_dict.get('range'):
                    desc += f" with range {t_dict.get('range')}"
                context_lines.append(f"- id: {t_dict.get('id')}, status: {t_dict.get('status')}, {desc}")
        else:
            context_lines.append("Current tasks: (none)")
    except Exception as e:
        context_lines.append(f"[Error fetching tasks: {e}]")
    # Only include non-user context (coordinates, location, etc.)
    if context:
        if 'center' in context:
            context_lines.append(f"Current map center: {context['center']}")
        if 'location' in context:
            context_lines.append(f"Location: {context['location']}")
        for k, v in context.items():
            if k not in ('center', 'location', 'user', 'is_admin'):
                context_lines.append(f"{k}: {v}")
    context_str = "\n".join(context_lines)
    return (
        f"You are an AI assistant for RE-Archaeology.\n"
        f"Always provide a helpful, conversational response to the user.\n"
        f"If the user's request matches a valid task action (except for listing tasks), you MUST output a single JSON object describing the command, using the schema below.\n"
        f"If the user's request does not match any valid action, do NOT output a JSON object—just respond conversationally.\n"
        f"\nContext:\n{context_str}\n\n"
        f"TaskManager Command JSON Schema (valid actions and arguments):\n"
        f"```json\n{json_schema}\n```\n\n"
        "Instructions for extracting details:\n"
        "- Always extract and include all relevant details from the user's message (such as task_id, coordinates, range_km, profiles, etc.) in the JSON command.\n"
        "- If the user provides a task ID, always include it.\n"
        "- If the user provides coordinates, range, or profiles, include them.\n"
        "- If the user omits required fields, respond conversationally and ask for clarification, but do NOT output incomplete JSON.\n"
        "- If the user asks to stop, pause, resume, or delete a task and provides a task ID, always include it in the JSON.\n"
        "- If the user provides extra details, include them in the JSON.\n"
        "- If the user asks for the status of a task or all tasks, answer directly from the current task list in the context above.\n"
        "- Never output a JSON command for listing tasks or status queries.\n"
        "\nExamples:\n"
        "User: Start a scan at the current location.\n"
        "Response: Sure! I will start a scan at the current map center.\n"
        '```json\n{"action": "start", "coordinates": [12.34, 56.78], "range_km": {"width": 5, "height": 5}, "profiles": ["default_windmill"]}\n```'"\n\n"
        "User: Pause my current task.\n"
        "Response: Pausing your current task.\n"
        '```json\n{"action": "pause", "task_id": "abc123"}\n```'"\n\n"
        "User: Stop task b506b2f2-d72c-40af-8775-5ff51418aafc\n"
        "Response: Stopping the task with ID b506b2f2-d72c-40af-8775-5ff51418aafc.\n"
        '```json\n{"action": "stop", "task_id": "b506b2f2-d72c-40af-8775-5ff51418aafc"}\n```'"\n\n"
        "User: Delete task aa5717e0-50f3-4938-afdd-bc559f51686d\n"
        "Response: Deleting the task with ID aa5717e0-50f3-4938-afdd-bc559f51686d.\n"
        '```json\n{"action": "delete", "task_id": "aa5717e0-50f3-4938-afdd-bc559f51686d"}\n```'"\n\n"
        "User: What tasks are running?\n"
        "Response: Here are your current tasks (from the context above):\n- id: 123, status: running, ...\n- id: 456, status: paused, ...\n(No JSON command needed.)\n\n"
        "User: What's the status of task abc123?\n"
        "Response: Task abc123 is currently paused. (No JSON command needed.)\n\n"
        "User: Tell me about lidar.\n"
        "Response: Lidar is a remote sensing method that uses light in the form of a pulsed laser to measure distances. (No JSON command needed.)\n\n"
        "---\n"
        "If you output a JSON command, it must be a single valid JSON object in a ```json code block after your conversational response.\n"
        "If no valid action is detected, do not output any JSON.\n"
        "If the user asks for a list or status of tasks, always answer directly from the context and never output a JSON command for listing.\n"
    )

async def llm_parse_task_command(message: str, context: dict = None) -> Optional[Dict[str, Any]]:
    """
    Use the LLM to interpret the user's intent and yield a task command dict if appropriate.
INFO:backend.api.routers.ai_chat_task_helpers:[DEBUG] User message: stop bff39dea-4ac6-468f-89a0-79c9499099c1
INFO:backend.api.routers.ai_chat_task_helpers:[DEBUG] Parsed command: {'action': 'stop', 'task_id': 'bff39dea-4ac6-468f-89a0-79c9499099c1'}
INFO:backend.api.routers.tasks:[TaskManager] stop requested for task_id: bff39dea-4ac6-468f-89a0-79c9499099c1
INFO:backend.api.routers.tasks:[Task.load] Looking for task_id: bff39dea-4ac6-468f-89a0-79c9499099c1
INFO:backend.api.routers.tasks:[Task.load] All available task IDs: ['1654286f-c922-4010-9391-ef324daebe0c', '3464eaba-c3ea-4033-aa2e-2155c4756c19', '4198d0e7-4313-4826-8292-74233cdcfe69', '460164cc-7026-4bed-a792-a3a1bcd9dbf6', '6a92e039-67e5-4fa8-921c-f439d8a4fb8a', 'aa5717e0-50f3-4938-afdd-bc559f51686d', 'bff39dea-4ac6-468f-89a0-79c9499099c1']
INFO:backend.api.routers.tasks:[Task.load] Found task with id: bff39dea-4ac6-468f-89a0-79c9499099c1
ERROR:backend.api.routers.tasks:[TaskManager] Exception in execute_command: cannot access local variable 'threading' where it is not associated with a value
INFO:backend.api.routers.ai_chat_task_helpers:[DEBUG] TaskManager execution result: {'success': False, 'message': "Error executing command: cannot access local variable 'threading' where it is not associated with a value"}
    Uses GPT-4o for improved reasoning and accuracy.
    """
    system_prompt = generate_task_system_prompt(context=context)
    client = AsyncOpenAI()
    try:
        response = await client.chat.completions.create(
            model="gpt-4o-mini",  # Updated model name to remove date suffix
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": message}
            ],
            max_tokens=256,
            temperature=0.2
        )
        content = response.choices[0].message.content
        # Log the LLM's raw output for debugging
        logger.info(f"LLM output: {content}")
        # Save the last LLM output for fallback use
        llm_parse_task_command.last_llm_output = content
        # Try to extract JSON from the LLM's response
        json_start = content.find('{')
        json_end = content.rfind('}') + 1
        if json_start != -1 and json_end > json_start:
            command_str = content[json_start:json_end]
            try:
                command = json.loads(command_str)
                logger.info(f"Extracted action JSON: {json.dumps(command, indent=2)}")
                if isinstance(command, dict) and 'action' in command:
                    return command
            except Exception as e:
                logger.warning(f"JSON extraction failed: {e}\nContent: {content}")
        else:
            logger.warning(f"No JSON object found in LLM output: {content}")
    except Exception as e:
        logger.warning(f"LLM parse failed: {e}")
        llm_parse_task_command.last_llm_output = None
    return None

async def handle_llm_task_message(message: str, context: dict = None):
    """
    1. Parse the user's message with the LLM.
    2. If a command is parsed, answer conversationally, then execute the command via TaskManager, and answer again with the result.
    3. If no command, just return the conversational answer.
    Returns a dict with: initial_response, command, execution_result, final_response
    """
    # 1. Parse and get LLM output
    command = await llm_parse_task_command(message, context)
    initial_response = None
    final_response = None
    execution_result = None

    logger.info(f"[DEBUG] User message: {message}")
    logger.info(f"[DEBUG] Parsed command: {command}")

    # Do NOT extract or pass user_id or is_admin from context; only pass coordinates/location context if present
    # All user/admin checks are handled in TaskManager

    if command:
        # 2. Compose initial conversational response (simulate what LLM would say)
        action = command.get('action')
        initial_response = f"Understood! I will perform the '{action}' action."

        # Remove any LLM-provided user_id to prevent privilege escalation
        if "user_id" in command:
            del command["user_id"]

        # Extract user_id (email) from context for admin check in TaskManager
        user_id = None
        if context and "user" in context and "email" in context["user"]:
            user_id = context["user"]["email"]

        # Pass command and user_id; TaskManager will handle all user/admin checks
        execution_result = system_task_manager.execute_command(command, user_id=user_id)
        logger.info(f"[DEBUG] TaskManager execution result: {execution_result}")
        # 4. Compose final response based on execution result
        if execution_result.get("success"):
            final_response = f"✅ Task '{action}' executed successfully."
        else:
            error_msg = execution_result.get("message") or "Task execution failed."
            final_response = f"❌ Could not execute task '{action}': {error_msg}"
    else:
        # No command, return the LLM's conversational output from the initial parse
        initial_response = getattr(llm_parse_task_command, 'last_llm_output', None)
        if not initial_response:
            initial_response = "I'm here to help! Let me know if you want to perform any tasks."

    return {
        "initial_response": initial_response,
        "command": command,
        "execution_result": execution_result,
        "final_response": final_response
    }

