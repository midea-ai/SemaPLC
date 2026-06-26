PROGRAM traffic_light
VAR
    (* Inputs *)
    emergency_button AT %IX0.0 : BOOL := FALSE;
    night_mode AT %IX0.1 : BOOL := FALSE;
    
    (* Outputs *)
    red_light AT %QX0.0 : BOOL := FALSE;
    yellow_light AT %QX0.1 : BOOL := FALSE;
    green_light AT %QX0.2 : BOOL := FALSE;
    
    (* Internal variables *)
    state : INT := 0; (* 0=RED, 1=GREEN, 2=YELLOW *)
    timer : TIME := TIME#0s;
    cycle_time : TIME := TIME#1s;
    
    (* State durations *)
    red_duration : TIME := TIME#5s;
    green_duration : TIME := TIME#8s;
    yellow_duration : TIME := TIME#2s;
    
    (* Emergency and night mode *)
    emergency_active : BOOL := FALSE;
    last_emergency : BOOL := FALSE;
    flash_timer : TIME := TIME#0s;
    flash_state : BOOL := FALSE;
END_VAR

(* Update timers *)
timer := timer + cycle_time;
flash_timer := flash_timer + cycle_time;

(* Emergency button edge detection *)
IF emergency_button AND NOT last_emergency THEN
    emergency_active := NOT emergency_active;
END_IF
last_emergency := emergency_button;

(* Emergency mode - flash yellow *)
IF emergency_active THEN
    red_light := FALSE;
    green_light := FALSE;
    
    IF flash_timer >= TIME#500ms THEN
        flash_state := NOT flash_state;
        flash_timer := TIME#0s;
    END_IF
    yellow_light := flash_state;
    
(* Night mode - flash yellow slowly *)
ELSIF night_mode THEN
    red_light := FALSE;
    green_light := FALSE;
    
    IF flash_timer >= TIME#1s THEN
        flash_state := NOT flash_state;
        flash_timer := TIME#0s;
    END_IF
    yellow_light := flash_state;
    
(* Normal traffic light cycle *)
ELSE
    flash_state := FALSE;
    flash_timer := TIME#0s;
    
    CASE state OF
        0: (* RED state *)
            red_light := TRUE;
            yellow_light := FALSE;
            green_light := FALSE;
            
            IF timer >= red_duration THEN
                state := 1;
                timer := TIME#0s;
            END_IF
            
        1: (* GREEN state *)
            red_light := FALSE;
            yellow_light := FALSE;
            green_light := TRUE;
            
            IF timer >= green_duration THEN
                state := 2;
                timer := TIME#0s;
            END_IF
            
        2: (* YELLOW state *)
            red_light := FALSE;
            yellow_light := TRUE;
            green_light := FALSE;
            
            IF timer >= yellow_duration THEN
                state := 0;
                timer := TIME#0s;
            END_IF
            
        ELSE
            (* Default to RED for safety *)
            state := 0;
            timer := TIME#0s;
    END_CASE
END_IF

END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : traffic_light;
END_RESOURCE
END_CONFIGURATION